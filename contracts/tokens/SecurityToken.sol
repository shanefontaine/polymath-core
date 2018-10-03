pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/Math.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IModule.sol";
import "../interfaces/IModuleFactory.sol";
import "../interfaces/IModuleRegistry.sol";
import "../interfaces/IFeatureRegistry.sol";
import "../modules/TransferManager/ITransferManager.sol";
import "../modules/PermissionManager/IPermissionManager.sol";
import "../RegistryUpdater.sol";
import "../libraries/Util.sol";
import "openzeppelin-solidity/contracts/ReentrancyGuard.sol";
import "openzeppelin-solidity/contracts/token/ERC20/StandardToken.sol";
import "openzeppelin-solidity/contracts/token/ERC20/DetailedERC20.sol";

/**
* @title Security Token contract
* @notice SecurityToken is an ERC20 token with added capabilities:
* @notice - Implements the ST-20 Interface
* @notice - Transfers are restricted
* @notice - Modules can be attached to it to control its behaviour
* @notice - ST should not be deployed directly, but rather the SecurityTokenRegistry should be used
* @notice - ST does not inherit from ISecurityToken due to:
* @notice - https://github.com/ethereum/solidity/issues/4847
*/
contract SecurityToken is StandardToken, DetailedERC20, ReentrancyGuard, RegistryUpdater {
    using SafeMath for uint256;

    // Use to hold the version
    struct SemanticVersion {
        uint8 major;
        uint8 minor;
        uint8 patch;
    }

    SemanticVersion public securityTokenVersion;

    // off-chain hash
    string public tokenDetails;

    uint8 public constant PERMISSION_KEY = 1;
    uint8 public constant TRANSFER_KEY = 2;
    uint8 public constant MINT_KEY = 3;
    uint8 public constant CHECKPOINT_KEY = 4;
    uint8 public constant BURN_KEY = 5;

    uint256 public granularity;

    // Value of current checkpoint
    uint256 public currentCheckpointId;

    // Total number of non-zero token holders
    uint256 public investorCount;

    // List of token holders
    address[] public investors;

    // Use to temporarily halt all transactions
    bool public transfersFrozen;

    // Use to permanently halt all minting
    bool public mintingFrozen;

    // Use to permanently halt controller actions
    bool public controllerDisabled;

    // address whitelisted by issuer as controller
    address public controller;

    event ModuleDataEvent(
        bytes32 name,
        address module,
        address moduleFactory,
        bool isArchived,
        uint8[] moduleTypes,
        uint256[] moduleIndexes,
        uint256 nameIndex
    );
    // Struct for module data
    struct ModuleData {
        bytes32 name;
        address module;
        address moduleFactory;
        bool isArchived;
        uint8[] moduleTypes;
        uint256[] moduleIndexes;
        uint256 nameIndex;
        mapping (uint8 => bool) moduleType;
        mapping (uint8 => uint256) moduleIndex;
    }

    // Records added modules - module list should be order agnostic!
    mapping (uint8 => address[]) public modules;

    // Records information about the module
    mapping (address => ModuleData) modulesToData;

    // Records added module names - module list should be order agnostic!
    mapping (bytes32 => address[]) names;

    // Structures to maintain checkpoints of balances for governance / dividends
    struct Checkpoint {
        uint256 checkpointId;
        uint256 value;
    }

    // Map each investor to a series of checkpoints
    mapping (address => Checkpoint[]) public checkpointBalances;

    // List of checkpoints that relate to total supply
    Checkpoint[] public checkpointTotalSupply;

    // Times at which each checkpoint was created
    uint256[] public checkpointTimes;

    // List of investors (may not be pruned to remove old investors with current zero balances)
    mapping (address => bool) public investorListed;

    // Emit at the time when module get added
    event ModuleAdded(
        uint8[] indexed _types,
        bytes32 _name,
        address _moduleFactory,
        address _module,
        uint256 _moduleCost,
        uint256 _budget,
        uint256 _timestamp
    );

    // Emit when the token details get updated
    event UpdateTokenDetails(string _oldDetails, string _newDetails);
    // Emit when the granularity get changed
    event GranularityChanged(uint256 _oldGranularity, uint256 _newGranularity);
    // Emit when Module get removed from the securityToken
    event ModuleRemoved(uint8[] indexed _types, address _module, uint256 _timestamp);
    // Emit when Module get archived from the securityToken
    event ModuleArchived(uint8[] indexed _types, address _module, uint256 _timestamp);
    // Emit when Module get unarchived from the securityToken
    event ModuleUnarchived(uint8[] indexed _types, address _module, uint256 _timestamp);
    // Emit when the budget allocated to a module is changed
    event ModuleBudgetChanged(uint8[] indexed _moduleTypes, address _module, uint256 _oldBudget, uint256 _budget);
    // Emit when transfers are frozen or unfrozen
    event FreezeTransfers(bool _status, uint256 _timestamp);
    // Emit when new checkpoint created
    event CheckpointCreated(uint256 indexed _checkpointId, uint256 _timestamp);
    // Emit when is permanently frozen by the issuer
    event FreezeMinting(uint256 _timestamp);
    // Change the STR address in the event of a upgrade
    event ChangeSTRAddress(address indexed _oldAddress, address indexed _newAddress);
    // Events to log minting and burning
    event Minted(address indexed _to, uint256 _value);
    event Burnt(address indexed _from, uint256 _value);

    // Events to log controller actions
    event SetController(address indexed _oldController, address indexed _newController);
    event ForceTransfer(address indexed _controller, address indexed _from, address indexed _to, uint256 _value, bool _verifyTransfer, bytes _data);
    event ForceBurn(address indexed _controller, address indexed _from, uint256 _value, bool _verifyTransfer, bytes _data);
    event DisableController(uint256 _timestamp);

    function _isModule(address _module, uint8 _type) internal view returns (bool) {
        require(modulesToData[_module].module == _module, "Address mismatch");
        require(modulesToData[_module].moduleType[_type], "Type mismatch");
        require(!modulesToData[_module].isArchived, "Module archived");
        return true;
    }

    // Require msg.sender to be the specified module type
    modifier onlyModule(uint8 _type) {
        require(_isModule(msg.sender, _type));
        _;
    }

    // Require msg.sender to be the specified module type or the owner of the token
    modifier onlyModuleOrOwner(uint8 _type) {
        if (msg.sender == owner) {
            _;
        } else {
            require(_isModule(msg.sender, _type));
            _;
        }
    }

    modifier checkGranularity(uint256 _value) {
        require(_value % granularity == 0, "Incorrect granularity");
        _;
    }

    modifier isMintingAllowed() {
        require(!mintingFrozen, "Minting is frozen");
        _;
    }

    modifier isEnabled(string _nameKey) {
        require(IFeatureRegistry(featureRegistry).getFeatureStatus(_nameKey));
        _;
    }

    /**
     * @notice Revert if called by account which is not a controller
     */
    modifier onlyController() {
        require(msg.sender == controller, "Caller not controller");
        require(!controllerDisabled, "Controller disabled");
        _;
    }

    /**
     * @notice Constructor
     * @param _name Name of the SecurityToken
     * @param _symbol Symbol of the Token
     * @param _decimals Decimals for the securityToken
     * @param _granularity granular level of the token
     * @param _tokenDetails Details of the token that are stored off-chain (IPFS hash)
     * @param _polymathRegistry Contract address of the polymath registry
     */
    constructor (
        string _name,
        string _symbol,
        uint8 _decimals,
        uint256 _granularity,
        string _tokenDetails,
        address _polymathRegistry
    )
    public
    DetailedERC20(_name, _symbol, _decimals)
    RegistryUpdater(_polymathRegistry)
    {
        //When it is created, the owner is the STR
        updateFromRegistry();
        tokenDetails = _tokenDetails;
        granularity = _granularity;
        securityTokenVersion = SemanticVersion(0,0,2);
    }

    /**
     * @notice Function used to attach the module in security token
     * @param _moduleFactory Contract address of the module factory that needs to be attached
     * @param _data Data used for the intialization of the module factory variables
     * @param _maxCost Maximum cost of the Module factory
     * @param _budget Budget of the Module factory
     */
    function addModule(
        address _moduleFactory,
        bytes _data,
        uint256 _maxCost,
        uint256 _budget
    ) external onlyOwner nonReentrant {
        _addModule(_moduleFactory, _data, _maxCost, _budget);
    }

    /**
    * @notice _addModule handles the attachment (or replacement) of modules for the ST
    * @dev  E.G.: On deployment (through the STR) ST gets a TransferManager module attached to it
    * @dev to control restrictions on transfers.
    * @dev You are allowed to add a new moduleType if:
    * @dev - there is no existing module of that type yet added
    * @dev - the last member of the module list is replacable
    * @param _moduleFactory is the address of the module factory to be added
    * @param _data is data packed into bytes used to further configure the module (See STO usage)
    * @param _maxCost max amount of POLY willing to pay to module. (WIP)
    */
    function _addModule(address _moduleFactory, bytes _data, uint256 _maxCost, uint256 _budget) internal {
        //Check that module exists in registry - will throw otherwise
        IModuleRegistry(moduleRegistry).useModule(_moduleFactory);
        IModuleFactory moduleFactory = IModuleFactory(_moduleFactory);
        uint8[] memory moduleTypes = moduleFactory.getTypes();
        /* require(modules[moduleType].length < MAX_MODULES, "Limit of MAX MODULES is reached"); */
        uint256 moduleCost = moduleFactory.getSetupCost();
        require(moduleCost <= _maxCost, "Module cost too high");
        //Approve fee for module
        require(ERC20(polyToken).approve(_moduleFactory, moduleCost), "Insufficient funds for cost");
        //Creates instance of module from factory
        address module = moduleFactory.deploy(_data);
        require(modulesToData[module].module == address(0), "Module already exists");
        //Approve ongoing budget
        require(ERC20(polyToken).approve(module, _budget), "Insufficient funds for budget");
        //Add to SecurityToken module map
        bytes32 moduleName = moduleFactory.getName();
        uint256[] memory moduleIndexes = new uint256[](moduleTypes.length);
        //Enforce type uniqueness
        uint256 i;
        uint256 j;
        for (i = 0; i < moduleTypes.length; i++) {
            for (j = 0; j < i; j++) {
                require(moduleTypes[i] != moduleTypes[j], "Bad types");
            }
        }
        for (i = 0; i < moduleTypes.length; i++) {
            moduleIndexes[i] = modules[moduleTypes[i]].length;
        }
        emit ModuleDataEvent(moduleName, module, _moduleFactory, false, moduleTypes, moduleIndexes, names[moduleName].length);
        /* modulesToData[module] = ModuleData(moduleName, module, _moduleFactory, false, moduleTypes, moduleIndexes, names[moduleName].length); */
        for (i = 0; i < moduleTypes.length; i++) {
            modules[moduleTypes[i]].push(module);
        }
        names[moduleName].push(module);
        //Emit log event
        emit ModuleAdded(moduleTypes, moduleName, _moduleFactory, module, moduleCost, _budget, now);
    }

    /**
    * @notice Archives a module attached to the SecurityToken
    * @param _module address of module to archive
    */
    function archiveModule(address _module) external onlyOwner {
        require(!modulesToData[_module].isArchived, "Module already archived");
        require(modulesToData[_module].module != address(0), "Module missing");
        emit ModuleArchived(modulesToData[_module].moduleTypes, _module, now);
        modulesToData[_module].isArchived = true;
    }

    /**
    * @notice Unarchives a module attached to the SecurityToken
    * @param _module address of module to unarchive
    */
    function unarchiveModule(address _module) external onlyOwner {
        require(modulesToData[_module].isArchived, "Module already unarchived");
        emit ModuleUnarchived(modulesToData[_module].moduleTypes, _module, now);
        modulesToData[_module].isArchived = false;
    }

    function _removeModuleWithIndex(uint8 _type, uint256 _index) internal {
        uint256 length = modules[_type].length;
        modules[_type][_index] = modules[_type][length - 1];
        modules[_type].length = length - 1;

        if ((length - 1) != _index) {
            //Need to find index of _type in moduleTypes of module we are moving
            uint8[] memory newTypes = modulesToData[modules[_type][_index]].moduleTypes;
            for (uint256 i = 0; i < newTypes.length; i++) {
                if (newTypes[i] == _type) {
                    modulesToData[modules[_type][_index]].moduleIndexes[i] = _index;
                }
            }
        }
    }

    /**
    * @notice Removes a module attached to the SecurityToken
    * @param _module address of module to unarchive
    */
    function removeModule(address _module) external onlyOwner {
        require(modulesToData[_module].isArchived, "Module not archived");
        require(modulesToData[_module].module != address(0), "Module missing");
        emit ModuleRemoved(modulesToData[_module].moduleTypes, _module, now);
        // Remove from module type list
        uint8[] memory moduleTypes = modulesToData[_module].moduleTypes;
        for (uint256 i = 0; i < moduleTypes.length; i++) {
            _removeModuleWithIndex(moduleTypes[i], modulesToData[_module].moduleIndexes[i]);
        }
        // Remove from module names list
        uint256 index = modulesToData[_module].nameIndex;
        bytes32 name = modulesToData[_module].name;
        uint256 length = names[name].length;
        names[name][index] = names[name][length - 1];
        names[name].length = length - 1;
        if ((length - 1) != index) {
            modulesToData[names[name][index]].nameIndex = index;
        }
        // Remove from modulesToData
        delete modulesToData[_module];
    }

    /**
     * @notice Returns module list for a module type
     * @param _module address of the module
     * @return bytes32 name
     * @return address module address
     * @return address module factory address
     * @return bool module archived
     * @return uint8 module type
     */
    function getModule(address _module) external view returns (bytes32, address, address, bool, uint8[]) {
        return (modulesToData[_module].name,
          modulesToData[_module].module,
          modulesToData[_module].moduleFactory,
          modulesToData[_module].isArchived,
          modulesToData[_module].moduleTypes);
    }

    /**
     * @notice returns module list for a module name
     * @param _name name of the module
     * @return address[] list of modules with this name
     */
    function getModulesByName(bytes32 _name) external view returns (address[]) {
        return names[_name];
    }

    /**
     * @notice returns module list for a module type
     * @param _type type of the module
     * @return address[] list of modules with this type
     */
    function getModulesByType(uint8 _type) external view returns (address[]) {
        return modules[_type];
    }

    /**
    * @notice allows the owner to withdraw unspent POLY stored by them on the ST.
    * @dev Owner can transfer POLY to the ST which will be used to pay for modules that require a POLY fee.
    * @param _value amount of POLY to withdraw
    */
    function withdrawPoly(uint256 _value) external onlyOwner {
        require(ERC20(polyToken).transfer(owner, _value), "Insufficient balance");
    }

    /**
    * @notice allows owner to approve more POLY to one of the modules
    * @param _module module address
    * @param _budget new budget
    */
    function changeModuleBudget(address _module, uint256 _budget) external onlyOwner {
        require(modulesToData[_module].module != address(0), "Module missing");
        uint256 _currentAllowance = IERC20(polyToken).allowance(address(this), _module);
        if (_budget < _currentAllowance) {
            require(IERC20(polyToken).decreaseApproval(_module, _currentAllowance.sub(_budget)), "Insufficient balance to decreaseApproval");
        } else {
            require(IERC20(polyToken).increaseApproval(_module, _budget.sub(_currentAllowance)), "Insufficient balance to increaseApproval");
        }
        emit ModuleBudgetChanged(modulesToData[_module].moduleTypes, _module, _currentAllowance, _budget);
    }

    /**
     * @notice change the tokenDetails
     * @param _newTokenDetails New token details
     */
    function updateTokenDetails(string _newTokenDetails) external onlyOwner {
        emit UpdateTokenDetails(tokenDetails, _newTokenDetails);
        tokenDetails = _newTokenDetails;
    }

    /**
    * @notice allows owner to change token granularity
    * @param _granularity granularity level of the token
    */
    function changeGranularity(uint256 _granularity) external onlyOwner {
        require(_granularity != 0, "Granularity can not be 0");
        emit GranularityChanged(granularity, _granularity);
        granularity = _granularity;
    }

    /**
    * @notice keeps track of the number of non-zero token holders
    * @param _from sender of transfer
    * @param _to receiver of transfer
    * @param _value value of transfer
    */
    function _adjustInvestorCount(address _from, address _to, uint256 _value) internal {
        if ((_value == 0) || (_from == _to)) {
            return;
        }
        // Check whether receiver is a new token holder
        if ((balanceOf(_to) == 0) && (_to != address(0))) {
            investorCount = investorCount.add(1);
        }
        // Check whether sender is moving all of their tokens
        if (_value == balanceOf(_from)) {
            investorCount = investorCount.sub(1);
        }
        //Also adjust investor list
        if (!investorListed[_to] && (_to != address(0))) {
            investors.push(_to);
            investorListed[_to] = true;
        }

    }

    /**
    * @notice removes addresses with zero balances from the investors list
    * @param _start Index in investor list at which to start removing zero balances
    * @param _iters Max number of iterations of the for loop
    * NB - pruning this list will mean you may not be able to iterate over investors on-chain as of a historical checkpoint
    */
    function pruneInvestors(uint256 _start, uint256 _iters) external onlyOwner {
        for (uint256 i = _start; i < Math.min256(_start.add(_iters), investors.length); i++) {
            if ((i < investors.length) && (balanceOf(investors[i]) == 0)) {
                investorListed[investors[i]] = false;
                investors[i] = investors[investors.length - 1];
                investors.length--;
            }
        }
    }

    /**
     * @notice gets length of investors array
     * NB - this length may differ from investorCount if list has not been pruned of zero balance investors
     * @return length
     */
    function getInvestorsLength() external view returns(uint256) {
        return investors.length;
    }

    /**
     * @notice freeze transfers
     */
    function freezeTransfers() external onlyOwner {
        require(!transfersFrozen);
        transfersFrozen = true;
        emit FreezeTransfers(true, now);
    }

    /**
     * @notice unfreeze transfers
     */
    function unfreezeTransfers() external onlyOwner {
        require(transfersFrozen);
        transfersFrozen = false;
        emit FreezeTransfers(false, now);
    }

    /**
     * @notice adjust totalsupply at checkpoint after minting or burning tokens
     */
    function _adjustTotalSupplyCheckpoints() internal {
        _adjustCheckpoints(checkpointTotalSupply, totalSupply());
    }

    /**
     * @notice adjust token holder balance at checkpoint after a token transfer
     * @param _investor address of the token holder affected
     */
    function _adjustBalanceCheckpoints(address _investor) internal {
        _adjustCheckpoints(checkpointBalances[_investor], balanceOf(_investor));
    }

    /**
     * @notice store the changes to the checkpoint objects
     * @param _checkpoints the affected checkpoint object array
     * @param _newValue the new value that needs to be stored
     */
    function _adjustCheckpoints(Checkpoint[] storage _checkpoints, uint256 _newValue) internal {
        //No checkpoints set yet
        if (currentCheckpointId == 0) {
            return;
        }
        //No previous checkpoint data - add current balance against checkpoint
        if (_checkpoints.length == 0) {
            _checkpoints.push(
                Checkpoint({
                    checkpointId: currentCheckpointId,
                    value: _newValue
                })
            );
            return;
        }
        //No new checkpoints since last update
        if (_checkpoints[_checkpoints.length - 1].checkpointId == currentCheckpointId) {
            return;
        }
        //New checkpoint, so record balance
        _checkpoints.push(
            Checkpoint({
                checkpointId: currentCheckpointId,
                value: _newValue
            })
        );
    }

    /**
     * @notice Overloaded version of the transfer function
     * @param _to receiver of transfer
     * @param _value value of transfer
     * @return bool success
     */
    function transfer(address _to, uint256 _value) public returns (bool success) {
        require(_updateTransfer(msg.sender, _to, _value), "Transfer is not valid");
        require(super.transfer(_to, _value));
        return true;
    }

    /**
     * @notice Overloaded version of the transferFrom function
     * @param _from sender of transfer
     * @param _to receiver of transfer
     * @param _value value of transfer
     * @return bool success
     */
    function transferFrom(address _from, address _to, uint256 _value) public returns(bool) {
        require(_updateTransfer(_from, _to, _value), "Transfer is not valid");
        require(super.transferFrom(_from, _to, _value));
        return true;
    }

    function _updateTransfer(address _from, address _to, uint256 _value) internal returns(bool) {
        _adjustInvestorCount(_from, _to, _value);
        _adjustBalanceCheckpoints(_from);
        _adjustBalanceCheckpoints(_to);
        return _verifyTransfer(_from, _to, _value, true);
    }

    /**
     * @notice validate transfer with TransferManager module if it exists
     * @dev TransferManager module has a key of 2
     * @param _from sender of transfer
     * @param _to receiver of transfer
     * @param _value value of transfer
     * @param _isTransfer whether transfer is being executed
     * @return bool
     */
    function _verifyTransfer(address _from, address _to, uint256 _value, bool _isTransfer) internal checkGranularity(_value) returns (bool) {
        if (!transfersFrozen) {
            if (modules[TRANSFER_KEY].length == 0) {
                return true;
            }
            bool isInvalid = false;
            bool isValid = false;
            bool isForceValid = false;
            bool unarchived = false;
            address module;
            for (uint8 i = 0; i < modules[TRANSFER_KEY].length; i++) {
                module = modules[TRANSFER_KEY][i];
                if (!modulesToData[module].isArchived) {
                    unarchived = true;
                    ITransferManager.Result valid = ITransferManager(module).verifyTransfer(_from, _to, _value, _isTransfer);
                    if (valid == ITransferManager.Result.INVALID) {
                        isInvalid = true;
                    }
                    if (valid == ITransferManager.Result.VALID) {
                        isValid = true;
                    }
                    if (valid == ITransferManager.Result.FORCE_VALID) {
                        isForceValid = true;
                    }
                }
            }
            // If no unarchived modules, return true by default
            return unarchived ? (isForceValid ? true : (isInvalid ? false : isValid)) : true;
      }
      return false;
    }

    /**
     * @notice validate transfer with TransferManager module if it exists
     * @dev TransferManager module has a key of 2
     * @param _from sender of transfer
     * @param _to receiver of transfer
     * @param _value value of transfer
     * @return bool
     */
    function verifyTransfer(address _from, address _to, uint256 _value) public returns (bool) {
        return _verifyTransfer(_from, _to, _value, false);
    }

    /**
     * @notice Permanently freeze minting of this security token.
     * @dev It MUST NOT be possible to increase `totalSuppy` after this function is called.
     */
    function freezeMinting() external isMintingAllowed() isEnabled("freezeMintingAllowed") onlyOwner {
        mintingFrozen = true;
        emit FreezeMinting(now);
    }

    /**
     * @notice mints new tokens and assigns them to the target _investor.
     * @dev Can only be called by the issuer or STO attached to the token
     * @param _investor Address where the minted tokens will be delivered
     * @param _value Number of tokens be minted
     * @return success
     */
    function mint(address _investor, uint256 _value) public onlyModuleOrOwner(MINT_KEY) checkGranularity(_value) isMintingAllowed() returns (bool success) {
        require(_investor != address(0), "Investor address should not be 0x");
        _adjustInvestorCount(address(0), _investor, _value);
        require(_verifyTransfer(address(0), _investor, _value, true), "Transfer is not valid");
        _adjustBalanceCheckpoints(_investor);
        _adjustTotalSupplyCheckpoints();
        totalSupply_ = totalSupply_.add(_value);
        balances[_investor] = balances[_investor].add(_value);
        emit Minted(_investor, _value);
        emit Transfer(address(0), _investor, _value);
        return true;
    }

    /**
     * @notice mints new tokens and assigns them to the target _investor.
     * @dev Can only be called by the issuer or STO attached to the token.
     * @param _investors A list of addresses to whom the minted tokens will be dilivered
     * @param _values A list of number of tokens get minted and transfer to corresponding address of the investor from _investor[] list
     * @return success
     */
    function mintMulti(address[] _investors, uint256[] _values) external onlyModuleOrOwner(MINT_KEY) returns (bool success) {
        require(_investors.length == _values.length, "Incorrect inputs");
        for (uint256 i = 0; i < _investors.length; i++) {
            mint(_investors[i], _values[i]);
        }
        return true;
    }

    /**
     * @notice Validate permissions with PermissionManager if it exists, If no Permission return false
     * @dev Note that IModule withPerm will allow ST owner all permissions anyway
     * @dev this allows individual modules to override this logic if needed (to not allow ST owner all permissions)
     * @param _delegate address of delegate
     * @param _module address of PermissionManager module
     * @param _perm the permissions
     * @return success
     */
    function checkPermission(address _delegate, address _module, bytes32 _perm) public view returns(bool) {
<<<<<<< HEAD
        if (modules[PERMISSION_KEY].length == 0) {
            return false;
        }

        for (uint8 i = 0; i < modules[PERMISSION_KEY].length; i++) {
            if (IPermissionManager(modules[PERMISSION_KEY][i]).checkPermission(_delegate, _module, _perm)) {
=======
        if (modules[PERMISSIONMANAGER_KEY].length == 0) {
            return false;
        }

        for (uint8 i = 0; i < modules[PERMISSIONMANAGER_KEY].length; i++) {
            if (IPermissionManager(modules[PERMISSIONMANAGER_KEY][i]).checkPermission(_delegate, _module, _perm)) {
>>>>>>> development-1.5.0
                return true;
            }
        }

        return false;
    }

    function _burn(address _from, uint256 _value) internal returns (bool) {
        require(_value <= balances[_from], "Value too high");
        require(_updateTransfer(_from, address(0), _value), "Burn is not valid");
        _adjustTotalSupplyCheckpoints();
        balances[_from] = balances[_from].sub(_value);
        totalSupply_ = totalSupply_.sub(_value);
        emit Burnt(_from, _value);
        emit Transfer(_from, address(0), _value);
        return true;
    }

    /**
     * @notice Burn function used to burn the securityToken
     * @param _value No. of tokens that get burned
     */
    function burn(uint256 _value) checkGranularity(_value) onlyModule(BURN_KEY) public returns (bool) {
        require(_burn(msg.sender, _value), "Invalid burn");
        return true;
    }

    /**
     * @notice Burn function used to burn the securityToken on behalf of someone else
     * @param _from Address for whom to burn tokens
     * @param _value No. of tokens that get burned
     */
    function burnFrom(address _from, uint256 _value) checkGranularity(_value) onlyModule(BURN_KEY) public returns (bool) {
        require(_value <= allowed[_from][msg.sender], "Value too high");
        allowed[_from][msg.sender] = allowed[_from][msg.sender].sub(_value);
        require(_burn(_from, _value), "Invalid burn");
        return true;
    }

    /**
     * @notice Creates a checkpoint that can be used to query historical balances / totalSuppy
     * @return uint256
     */
    function createCheckpoint() external onlyModuleOrOwner(CHECKPOINT_KEY) returns(uint256) {
        require(currentCheckpointId < 2**256 - 1);
        currentCheckpointId = currentCheckpointId + 1;
        checkpointTimes.push(now);
        emit CheckpointCreated(currentCheckpointId, now);
        return currentCheckpointId;
    }

    /**
     * @notice Gets list of times that checkpoints were created
     * @return List of checkpoint times
     */
    function getCheckpointTimes() external view returns(uint256[]) {
        return checkpointTimes;
    }

    /**
     * @notice Queries totalSupply as of a defined checkpoint
     * @param _checkpointId Checkpoint ID to query
     * @return uint256
     */
    function totalSupplyAt(uint256 _checkpointId) external view returns(uint256) {
        return _getValueAt(checkpointTotalSupply, _checkpointId, totalSupply());
    }

    /**
     * @notice Queries value at a defined checkpoint
     * @param checkpoints is array of Checkpoint objects
     * @param _checkpointId Checkpoint ID to query
     * @param _currentValue Current value of checkpoint
     * @return uint256
     */
    function _getValueAt(Checkpoint[] storage checkpoints, uint256 _checkpointId, uint256 _currentValue) internal view returns(uint256) {
        require(_checkpointId <= currentCheckpointId);
        //Checkpoint id 0 is when the token is first created - everyone has a zero balance
        if (_checkpointId == 0) {
          return 0;
        }
        if (checkpoints.length == 0) {
            return _currentValue;
        }
        if (checkpoints[0].checkpointId >= _checkpointId) {
            return checkpoints[0].value;
        }
        if (checkpoints[checkpoints.length - 1].checkpointId < _checkpointId) {
            return _currentValue;
        }
        if (checkpoints[checkpoints.length - 1].checkpointId == _checkpointId) {
            return checkpoints[checkpoints.length - 1].value;
        }
        uint256 min = 0;
        uint256 max = checkpoints.length - 1;
        while (max > min) {
            uint256 mid = (max + min) / 2;
            if (checkpoints[mid].checkpointId == _checkpointId) {
                max = mid;
                break;
            }
            if (checkpoints[mid].checkpointId < _checkpointId) {
                min = mid + 1;
            } else {
                max = mid;
            }
        }
        return checkpoints[max].value;
    }

    /**
     * @notice Queries balances as of a defined checkpoint
     * @param _investor Investor to query balance for
     * @param _checkpointId Checkpoint ID to query as of
     */
    function balanceOfAt(address _investor, uint256 _checkpointId) public view returns(uint256) {
        return _getValueAt(checkpointBalances[_investor], _checkpointId, balanceOf(_investor));
    }

    /**
     * @notice Use by the issuer ot set the controller addresses
     * @param _controller address of the controller
     */
    function setController(address _controller) public onlyOwner {
        require(!controllerDisabled);
        emit SetController(controller, _controller);
        controller = _controller;
    }

    /**
     * @notice Use by the issuer to permanently disable controller functionality
     * @dev enabled via feature switch "disableControllerAllowed"
     */
    function disableController() external isEnabled("disableControllerAllowed") onlyOwner {
        require(!controllerDisabled);
        controllerDisabled = true;
        delete controller;
        emit DisableController(now);
    }

    /**
     * @notice Use by a controller to execute a foced transfer
     * @param _from address from which to take tokens
     * @param _to address where to send tokens
     * @param _value amount of tokens to transfer
     * @param _data data attached to the transfer by controller to emit in event
     */
    function forceTransfer(address _from, address _to, uint256 _value, bytes _data) public onlyController returns(bool) {
        require(_to != address(0));
        require(_value <= balances[_from]);
        bool verified = _updateTransfer(_from, _to, _value);
        balances[_from] = balances[_from].sub(_value);
        balances[_to] = balances[_to].add(_value);

        emit ForceTransfer(msg.sender, _from, _to, _value, verified, _data);
        emit Transfer(_from, _to, _value);
        return true;
    }

    /**
     * @notice Use by a controller to execute a foced burn
     * @param _from address from which to take tokens
     * @param _value amount of tokens to transfer
     * @param _data data attached to the transfer by controller to emit in event
     */
    function forceBurn(address _from, uint256 _value, bytes _data) public onlyController returns(bool) {
        require(_value <= balances[_from], "Value too high");
        bool verified = _updateTransfer(_from, address(0), _value);
        _adjustTotalSupplyCheckpoints();
        balances[_from] = balances[_from].sub(_value);
        totalSupply_ = totalSupply_.sub(_value);
        emit ForceBurn(msg.sender, _from, _value, verified, _data);
        emit Burnt(_from, _value);
        emit Transfer(_from, address(0), _value);
        return true;
    }

    /**
     * @notice Use to get the version of the securityToken
     */
    function getVersion() external view returns(uint8[]) {
        uint8[] memory _version = new uint8[](3);
        _version[0] = securityTokenVersion.major;
        _version[1] = securityTokenVersion.minor;
        _version[2] = securityTokenVersion.patch;
        return _version;
    }

}
