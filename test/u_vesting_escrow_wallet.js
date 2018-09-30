import latestTime from './helpers/latestTime';
import { duration, ensureException, promisifyLogWatch, latestBlock } from './helpers/utils';
import takeSnapshot, { increaseTime, revertToSnapshot } from './helpers/time';
import { encodeProxyCall } from './helpers/encodeCall';

const PolymathRegistry = artifacts.require('./PolymathRegistry.sol')
const ModuleRegistry = artifacts.require('./ModuleRegistry.sol');
const SecurityToken = artifacts.require('./SecurityToken.sol');
const SecurityTokenRegistry = artifacts.require('./SecurityTokenRegistry.sol');
const SecurityTokenRegistryProxy = artifacts.require('./SecurityTokenRegistryProxy.sol');
const FeatureRegistry = artifacts.require('./FeatureRegistry.sol');
const STFactory = artifacts.require('./STFactory.sol');
const GeneralPermissionManagerFactory = artifacts.require('./GeneralPermissionManagerFactory.sol');
const GeneralTransferManagerFactory = artifacts.require('./GeneralTransferManagerFactory.sol');
const GeneralTransferManager = artifacts.require('./GeneralTransferManager');
const VestingEscrowWalletFactory = artifacts.require('./VestingEscrowWalletFactory.sol');
const VestingEscrowWallet = artifacts.require('./VestingEscrowWallet.sol');
const GeneralPermissionManager = artifacts.require('./GeneralPermissionManager');
const PolyTokenFaucet = artifacts.require('./PolyTokenFaucet.sol');

const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545")) // Hardcoded development port

contract('VestingEscrowWallet', accounts => {

    // Accounts Variable declaration
    let account_polymath;
    let account_issuer;
    let token_owner;
    let employee1;
    let employee2;
    let employee3;
    let employee4;
    let account_temp;

    // investor Details
    let fromTime = latestTime();
    let toTime = latestTime();
    let expiryTime = toTime + duration.days(15);

    let message = "Transaction Should Fail!";

    // Contract Instance Declaration
    let I_GeneralPermissionManagerFactory;
    let I_GeneralTransferManagerFactory;
    let I_SecurityTokenRegistryProxy;
    let I_VestingEscrowWalletFactory;
    let P_VestingEscrowWalletFactory;
    let P_VestingEscrowWallet;
    let I_GeneralPermissionManager;
    let I_VestingEscrowWallet;
    let I_GeneralTransferManager;
    let I_ExchangeTransferManager;
    let I_ModuleRegistry;
    let I_STRProxied;
    let I_FeatureRegistry;
    let I_SecurityTokenRegistry;
    let I_STFactory;
    let I_SecurityToken;
    let I_PolyToken;
    let I_PolymathRegistry;

    // SecurityToken Details
    const name = "Team";
    const symbol = "sap";
    const tokenDetails = "This is equity type of issuance";
    const decimals = 18;
    const contact = "team@polymath.network";
    let snapId;
    // Module key
    const delegateManagerKey = 1;
    const transferManagerKey = 2;
    const stoKey = 3;
    const checkpointKey = 4;
    const walletKey = 5;

    // Initial fee for ticker registry and security token registry
    const initRegFee = web3.utils.toWei("250");

    before(async() => {
        // Accounts setup
        account_polymath = accounts[0];
        account_issuer = accounts[1];

        token_owner = account_issuer;

        employee1 = accounts[6];
        employee2 = accounts[7];
        employee3 = accounts[8];
        employee4 = accounts[9];
        account_temp = accounts[2];

        // ----------- POLYMATH NETWORK Configuration ------------

        // Step 0: Deploy the PolymathRegistry
        I_PolymathRegistry = await PolymathRegistry.new({from: account_polymath});

        // Step 1: Deploy the token Faucet and Mint tokens for token_owner
        I_PolyToken = await PolyTokenFaucet.new();
        await I_PolyToken.getTokens((10000 * Math.pow(10, 18)), token_owner);
        await I_PolymathRegistry.changeAddress("PolyToken", I_PolyToken.address, {from: account_polymath})

        // STEP 2: Deploy the ModuleRegistry
        I_ModuleRegistry = await ModuleRegistry.new(I_PolymathRegistry.address, {from:account_polymath});
        await I_PolymathRegistry.changeAddress("ModuleRegistry", I_ModuleRegistry.address, {from: account_polymath});

        assert.notEqual(
            I_ModuleRegistry.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "ModuleRegistry contract was not deployed"
        );

        // STEP 2: Deploy the GeneralTransferManagerFactory
        I_GeneralTransferManagerFactory = await GeneralTransferManagerFactory.new(I_PolyToken.address, 0, 0, 0, {from:account_polymath});

        assert.notEqual(
            I_GeneralTransferManagerFactory.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "GeneralTransferManagerFactory contract was not deployed"
        );

        // STEP 3: Deploy the GeneralDelegateManagerFactory
        I_GeneralPermissionManagerFactory = await GeneralPermissionManagerFactory.new(I_PolyToken.address, 0, 0, 0, {from:account_polymath});

        assert.notEqual(
            I_GeneralPermissionManagerFactory.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "GeneralDelegateManagerFactory contract was not deployed"
        );

        // STEP 4: Deploy the VestingWallet
        P_VestingEscrowWalletFactory = await VestingEscrowWalletFactory.new(I_PolyToken.address, web3.utils.toWei("500","ether"), 0, 0, {from:account_polymath});
        assert.notEqual(
            P_VestingEscrowWalletFactory.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "VestingEscrowWalletFactory contract was not deployed"
        );

        // STEP 4: Deploy the VestingWallet
        I_VestingEscrowWalletFactory = await VestingEscrowWalletFactory.new(I_PolyToken.address, 0, 0, 0, {from:account_polymath});
        assert.notEqual(
            I_VestingEscrowWalletFactory.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "VestingEscrowWalletFactory contract was not deployed"
        );

        // STEP 5: Register the Modules with the ModuleRegistry contract
        // (A) :  Register the GeneralTransferManagerFactory
        await I_ModuleRegistry.registerModule(I_GeneralTransferManagerFactory.address, { from: account_polymath });
        await I_ModuleRegistry.verifyModule(I_GeneralTransferManagerFactory.address, true, { from: account_polymath });

        // (B) :  Register the GeneralDelegateManagerFactory
        await I_ModuleRegistry.registerModule(I_GeneralPermissionManagerFactory.address, { from: account_polymath });
        await I_ModuleRegistry.verifyModule(I_GeneralPermissionManagerFactory.address, true, { from: account_polymath });

        // (C) : Register the VestingEscrowWalletFactory
        await I_ModuleRegistry.registerModule(I_VestingEscrowWalletFactory.address, { from: account_polymath });
        await I_ModuleRegistry.verifyModule(I_VestingEscrowWalletFactory.address, true, { from: account_polymath });

        // (C) : Register the Paid VestingEscrowWalletFactory
        await I_ModuleRegistry.registerModule(P_VestingEscrowWalletFactory.address, { from: account_polymath });
        await I_ModuleRegistry.verifyModule(P_VestingEscrowWalletFactory.address, true, { from: account_polymath });

        // Step 7: Deploy the STFactory contract
        I_STFactory = await STFactory.new(I_GeneralTransferManagerFactory.address);

        assert.notEqual(
            I_STFactory.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "STFactory contract was not deployed",
        );

       // Step 9: Deploy the SecurityTokenRegistry
        // Deploy the SecurityTokenregistry
        I_SecurityTokenRegistry = await SecurityTokenRegistry.new({from: account_polymath });

        assert.notEqual(
            I_SecurityTokenRegistry.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "SecurityTokenRegistry contract was not deployed",
        );

        // Step 10: update the registries addresses from the PolymathRegistry contract
        I_SecurityTokenRegistryProxy = await SecurityTokenRegistryProxy.new({from: account_polymath});
        let bytesProxy = encodeProxyCall([I_PolymathRegistry.address, I_STFactory.address, initRegFee, initRegFee, I_PolyToken.address, account_polymath]);
        await I_SecurityTokenRegistryProxy.upgradeToAndCall("1.0.0", I_SecurityTokenRegistry.address, bytesProxy, {from: account_polymath});
        I_STRProxied = await SecurityTokenRegistry.at(I_SecurityTokenRegistryProxy.address);

        // Step 10: Deploy the FeatureRegistry
        I_FeatureRegistry = await FeatureRegistry.new(
            I_PolymathRegistry.address,
            {
                from: account_polymath
            });
        await I_PolymathRegistry.changeAddress("FeatureRegistry", I_FeatureRegistry.address, {from: account_polymath});

        assert.notEqual(
            I_FeatureRegistry.address.valueOf(),
            "0x0000000000000000000000000000000000000000",
            "FeatureRegistry contract was not deployed",
        );

        // Step 11: update the registries addresses from the PolymathRegistry contract
        await I_PolymathRegistry.changeAddress("SecurityTokenRegistry", I_STRProxied.address, {from: account_polymath});
        await I_ModuleRegistry.updateFromRegistry({from: account_polymath});

        // Printing all the contract addresses
        console.log(`
        --------------------- Polymath Network Smart Contracts: ---------------------
        PolymathRegistry:                  ${PolymathRegistry.address}
        SecurityTokenRegistryProxy:        ${SecurityTokenRegistryProxy.address}
        SecurityTokenRegistry:             ${SecurityTokenRegistry.address}
        ModuleRegistry:                    ${ModuleRegistry.address}
        FeatureRegistry:                   ${FeatureRegistry.address}

        STFactory:                         ${STFactory.address}
        GeneralTransferManagerFactory:     ${GeneralTransferManagerFactory.address}
        GeneralPermissionManagerFactory:   ${GeneralPermissionManagerFactory.address}

        VestingEscrowWalletFactory:    ${I_VestingEscrowWalletFactory.address}
        -----------------------------------------------------------------------------
        `);
    });

    describe("Generate the SecurityToken", async() => {

      it("Should register the ticker before the generation of the security token", async () => {
          await I_PolyToken.approve(I_STRProxied.address, initRegFee, { from: token_owner });
          let tx = await I_STRProxied.registerTicker(token_owner, symbol, contact, { from : token_owner });
          assert.equal(tx.logs[0].args._owner, token_owner);
          assert.equal(tx.logs[0].args._ticker, symbol.toUpperCase());
      });

      it("Should generate the new security token with the same symbol as registered above", async () => {
          await I_PolyToken.approve(I_STRProxied.address, initRegFee, { from: token_owner });
          let _blockNo = latestBlock();
          let tx = await I_STRProxied.generateSecurityToken(name, symbol, tokenDetails, false, { from: token_owner, gas: 85000000 });

          // Verify the successful generation of the security token
          assert.equal(tx.logs[1].args._ticker, symbol.toUpperCase(), "SecurityToken doesn't get deployed");

          I_SecurityToken = SecurityToken.at(tx.logs[1].args._securityTokenAddress);

          const log = await promisifyLogWatch(I_SecurityToken.LogModuleAdded({from: _blockNo}), 1);
          // Verify that 0 module get added successfully or not
          assert.equal(log.args._type.toNumber(), 2);
          assert.equal(
              web3.utils.toAscii(log.args._name)
              .replace(/\u0000/g, ''),
              "GeneralTransferManager"
          );
      });

      it("Should intialize the auto attached modules", async () => {
         let moduleData = await I_SecurityToken.modules(2, 0);
         I_GeneralTransferManager = GeneralTransferManager.at(moduleData);

      });

      it("Should successfully attach the VestingEscrowWallet with the security token", async () => {
          let errorThrown = false;
          try {
              const tx = await I_SecurityToken.addModule(P_VestingEscrowWalletFactory.address, "", web3.utils.toWei("500", "ether"), 0, { from: token_owner });
          } catch(error) {
              console.log(`       tx -> failed because Token is not paid`.grey);
              ensureException(error);
              errorThrown = true;
          }
          assert.ok(errorThrown, message);
      });

      it("Should successfully attach the VestingEscrowWallet with the security token", async () => {
          let snapId = await takeSnapshot()
          await I_PolyToken.getTokens(web3.utils.toWei("500", "ether"), token_owner);
          await I_PolyToken.transfer(I_SecurityToken.address, web3.utils.toWei("500", "ether"), {from: token_owner});
          const tx = await I_SecurityToken.addModule(P_VestingEscrowWalletFactory.address, "", web3.utils.toWei("500", "ether"), 0, { from: token_owner });
          assert.equal(tx.logs[3].args._type.toNumber(), walletKey, "VestingEscrowWallet doesn't get deployed");
          assert.equal(
              web3.utils.toAscii(tx.logs[3].args._name)
              .replace(/\u0000/g, ''),
              "VestingEscrowWallet",
              "VestingEscrowWallet module was not added"
          );
          P_VestingEscrowWallet = VestingEscrowWallet.at(tx.logs[3].args._module);
          await revertToSnapshot(snapId);
      });

      it("Should successfully attach the VestingEscrowWallet with the security token", async () => {
        const tx = await I_SecurityToken.addModule(I_VestingEscrowWalletFactory.address, "", 0, 0, { from: token_owner });
        assert.equal(tx.logs[2].args._type.toNumber(), walletKey, "VestingEscrowWallet doesn't get deployed");
        assert.equal(
            web3.utils.toAscii(tx.logs[2].args._name)
            .replace(/\u0000/g, ''),
            "VestingEscrowWallet",
            "VestingEscrowWallet module was not added"
        );
        I_VestingEscrowWallet = VestingEscrowWallet.at(tx.logs[2].args._module);
      });
    });

    describe("Check Escrow Wallet", async() => {
      context("Create Template", async() => {
        it("Should fail to create a vesting schedule template", async() => {
          let totalAllocation = '10000';
          let errorThrown = false;
          let vestingDuration = latestTime() + duration.years(4);
          let vestingFrequency = (duration.years(1)/4);
          try {
            let tx = await I_VestingEscrowWallet.createTemplate(web3.utils.toWei(totalAllocation, 'ether'), vestingDuration, vestingFrequency, {from: employee1});
          } catch(error) {
              console.log(`       tx -> failed because caller is not the issuer`.grey);
              ensureException(error);
              errorThrown = true;
          }
          assert.ok(errorThrown, message);
        });
        it("Create a vesting schedule template", async() => {
          let totalAllocation = '10000';
          let vestingDuration = duration.years(4);
          let vestingFrequency = (duration.years(1)/4);
          let tx = await I_VestingEscrowWallet.createTemplate(web3.utils.toWei(totalAllocation, 'ether'), vestingDuration, vestingFrequency, {from: token_owner});

          assert.equal(tx.logs[0].args.templateNumber.toNumber(), 0, "Template should be created at number 0");
        });
        it("Create two more vesting schdule templates", async() => {
          let totalAllocation = ['25000', '50000'];
          let vestingDuration = duration.years(4);
          let vestingFrequency = (duration.years(1)/4);
          let tx = await I_VestingEscrowWallet.createTemplate(web3.utils.toWei(totalAllocation[0], 'ether'), vestingDuration, vestingFrequency, {from: token_owner});
          assert.equal(tx.logs[0].args.templateNumber.toNumber(), 1, "Template should be created at number 1");
          tx = await I_VestingEscrowWallet.createTemplate(web3.utils.toWei(totalAllocation[1], 'ether'), vestingDuration, vestingFrequency, {from: token_owner});
          assert.equal(tx.logs[0].args.templateNumber.toNumber(), 2, "Template should be created at number 2");
        });
        it("Increment the templateCount", async() => {
          let totalAllocation = '10000';
          let vestingDuration = duration.years(4);
          let vestingFrequency = (duration.years(1)/4);
          let count = await I_VestingEscrowWallet.templateCount.call();
          assert.equal(count.toNumber(), 3, "Template count should be 3");
        });
      })
      context("Initiate Vesting Schedule", async() => {
        it("Should fail to initiate a vesting schedule because the caller is not the owner", async() => {
          let errorThrown = false;
          let target = [employee1, employee2, employee3]
          let totalAllocation = ['10000', '25000', '50000'];
          totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
          let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
          let startDate = [latestTime() + duration.days(1), latestTime() + duration.days(2), latestTime() + duration.days(3)]
          let vestingFrequency = [(duration.years(1)/4),(duration.years(1)/2), (duration.years(1)/2)];
          let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
          try {
            let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: employee1});
          } catch(error) {
              console.log(`       tx -> failed because caller is not the issuer`.grey);
              Object.keys(error).forEach(function (key){
                ensureException(error[key]);
              });
              errorThrown = true;
          }
          assert.ok(errorThrown, message);
        });
        it("Should fail to initiate a vesting schedule because the the input arrays are not of equal length", async() => {
          let errorThrown = false;
          let target = [employee1, employee2]
          let totalAllocation = ['10000', '25000', '50000'];
          totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
          let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
          let startDate = [latestTime() + duration.days(1), latestTime() + duration.days(2), latestTime() + duration.days(3)]
          let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
          let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
          try {
            let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
          } catch(error) {
              console.log(`       tx -> failed because arrays ar unequal`.grey);
              Object.keys(error).forEach(function (key){
                ensureException(error[key]);
              });
              errorThrown = true;
          }
          assert.ok(errorThrown, message);
        });
        it("Should add to the whitelist", async() => {
            // Add the Investor in to the whitelist

            let tx = await I_GeneralTransferManager.modifyWhitelist(
                token_owner,
                latestTime(),
                latestTime(),
                latestTime() + duration.days(10),
                true,
                {
                    from: token_owner,
                    gas: 500000
                });

            assert.equal(tx.logs[0].args._investor.toLowerCase(), token_owner.toLowerCase(), "Failed in adding the investor in whitelist");
        });
        it("Should add to the whitelist", async() => {
            // Add the Investor in to the whitelist

            let tx = await I_GeneralTransferManager.modifyWhitelist(
                employee1,
                latestTime(),
                latestTime(),
                latestTime() + duration.days(10),
                true,
                {
                    from: token_owner,
                    gas: 500000
                });

            assert.equal(tx.logs[0].args._investor.toLowerCase(), employee1.toLowerCase(), "Failed in adding the investor in whitelist");
        });
        it("Should add to the whitelist", async() => {
            // Add the Investor in to the whitelist

            let tx = await I_GeneralTransferManager.modifyWhitelist(
                I_VestingEscrowWallet.address,
                latestTime(),
                latestTime(),
                latestTime() + duration.days(10),
                true,
                {
                    from: token_owner,
                    gas: 500000
                });

            assert.equal(tx.logs[0].args._investor.toLowerCase(), I_VestingEscrowWallet.address.toLowerCase(), "Failed in adding the investor in whitelist");
        });

        it("Should fail to initiate a vesting schedule because a target input was 0", async() => {
          let errorThrown = false;
          let target = [employee1, employee2, employee3]
          let totalAllocation = ['16', '20', '24'];
          totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
          let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
          let startDate = [latestTime() + duration.days(1), latestTime() + duration.days(2), latestTime() + duration.days(3)]
          let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
          // await I_SecurityToken.mint(I_VestingEscrowWallet.address, web3.utils.toWei('500', 'ether'), { from: token_owner });
          // await I_SecurityToken.approve(I_VestingEscrowWallet.address, web3.utils.toWei('500', 'ether'), {from: token_owner});
          var test = await I_SecurityToken.balanceOf(token_owner);
          console.log(test.valueOf())
          console.log(I_VestingEscrowWallet.address);
          console.log(web3.utils.toWei('5', 'ether'));

          var txion = await I_SecurityToken.transfer(I_VestingEscrowWallet.address, web3.utils.toWei('5', 'ether'), {from: token_owner})
          // await I_PolyToken.getTokens(web3.utils.toWei('5000000', 'ether'), token_owner);
          await I_PolyToken.approve(I_VestingEscrowWallet.address, web3.utils.toWei('5000000', 'ether'), {from: token_owner});
          await I_PolyToken.approve(token_owner, web3.utils.toWei('5000000', 'ether'), {from: token_owner});

          let test2 = await I_PolyToken.balanceOf(token_owner);
          let test3 = await I_PolyToken.balanceOf(I_VestingEscrowWallet.address);

          console.log("New owner -    ", test2);
          console.log("New contract - ", test3);


          let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
          console.log(params);
          let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});

          // try {
          //   let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
          // } catch(error) {
          //     console.log(`       tx -> failed because a target input was 0`.grey);
          //     Object.keys(error).forEach(function (key){
          //       ensureException(error[key]);
          //     });
          //     errorThrown = true;
          // }
          // assert.ok(errorThrown, message);
        });
      //   it("Should fail to initiate a vesting schedule because a totalAllocation input was 0", async() => {
      //     let errorThrown = false;
      //     let target = [employee1, employee2, employee3]
      //     let totalAllocation = ['10000', '25000', '50000'];
      //     totalAllocation = [0, web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
      //     let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
      //     let startDate = [latestTime() + duration.days(1), latestTime() + duration.days(2), latestTime() + duration.days(3)]
      //     let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
      //     let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
      //     try {
      //       let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
      //     } catch(error) {
      //         console.log(`       tx -> failed because a totalAllocation input was 0`.grey);
      //         Object.keys(error).forEach(function (key){
      //           ensureException(error[key]);
      //         });
      //         errorThrown = true;
      //     }
      //     assert.ok(errorThrown, message);
      //   });
      //   it("Should fail to initiate a vesting schedule because a vestingDuration input was 0", async() => {
      //     let errorThrown = false;
      //     let target = [employee1, employee2, employee3]
      //     let totalAllocation = ['10000', '25000', '50000'];
      //     totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
      //     let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
      //     let startDate = [latestTime() + duration.days(1), latestTime() + duration.days(2), latestTime() + duration.days(3)]
      //     let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
      //     let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
      //     try {
      //       let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
      //     } catch(error) {
      //         console.log(`       tx -> failed because a vestingDuration input was 0`.grey);
      //         Object.keys(error).forEach(function (key){
      //           ensureException(error[key]);
      //         });
      //         errorThrown = true;
      //     }
      //     assert.ok(errorThrown, message);
      //   });
      //   it("Should fail to initiate a vesting schedule because a startDate was input was before now", async() => {
      //     let errorThrown = false;
      //     let target = [employee1, employee2, employee3]
      //     let totalAllocation = ['10000', '25000', '50000'];
      //     totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
      //     let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
      //     let startDate = [0, latestTime() + duration.days(2), latestTime() + duration.days(3)]
      //     let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
      //     let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
      //     try {
      //       let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
      //     } catch(error) {
      //         console.log(`       tx -> failed because a startDate input was 0`.grey);
      //         Object.keys(error).forEach(function (key){
      //           ensureException(error[key]);
      //         });
      //         errorThrown = true;
      //     }
      //     assert.ok(errorThrown, message);
      //   });
      //   it("Should fail to initiate a vesting schedule because a vestingFrequency input was 0", async() => {
      //     let errorThrown = false;
      //     let target = [employee1, employee2, employee3]
      //     let totalAllocation = ['10000', '25000', '50000'];
      //     totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
      //     let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
      //     let startDate = [0, latestTime() + duration.days(2), latestTime() + duration.days(3)]
      //     let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
      //     let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
      //     try {
      //       let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
      //     } catch(error) {
      //         console.log(`       tx -> failed because a vestingFrequency input was 0`.grey);
      //         Object.keys(error).forEach(function (key){
      //           ensureException(error[key]);
      //         });
      //         errorThrown = true;
      //     }
      //     assert.ok(errorThrown, message);
      //   });
      //   it("Should fail to initiate a vesting schedule because a vestingFrequency was greater than the associated vestingDuration", async() => {
      //     let errorThrown = false;
      //     let target = [employee1, employee2, employee3]
      //     let totalAllocation = ['10000', '25000', '50000'];
      //     totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
      //     let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
      //     let startDate = [latestTime() + duration.days(2), latestTime() + duration.days(2), latestTime() + duration.days(3)]
      //     let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
      //     let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
      //     try {
      //       let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
      //     } catch(error) {
      //         console.log(`       tx -> failed because a startDate input was 0`.grey);
      //         Object.keys(error).forEach(function (key){
      //           ensureException(error[key]);
      //         });
      //         errorThrown = true;
      //     }
      //     assert.ok(errorThrown, message);
      //   });
      //   it("Should fail to initiate a vesting schedule because a vestingFrequency was not a whole factor of the associated vestingDuration ", async() => {
      //     let errorThrown = false;
      //     let target = [employee1, employee2, employee3]
      //     let totalAllocation = ['10000', '25000', '50000'];
      //     totalAllocation = [web3.utils.toWei(totalAllocation[0], 'ether'), web3.utils.toWei(totalAllocation[1], 'ether'), web3.utils.toWei(totalAllocation[2], 'ether')]
      //     let vestingDuration = [duration.years(4), duration.years(4), duration.years(4)];
      //     let startDate = [latestTime() + duration.days(2), latestTime() + duration.days(2), latestTime() + duration.days(3)]
      //     let vestingFrequency = [(duration.years(1)/4), (duration.years(1)/2), (duration.years(1)/2)];
      //     let params = [target, totalAllocation, vestingDuration, startDate, vestingFrequency];
      //     try {
      //       let tx = await I_VestingEscrowWallet.initiateVestingSchedule(params[0], params[1], params[2], params[3], params[4], {from: token_owner});
      //     } catch(error) {
      //         console.log(`       tx -> failed because a startDate input was 0`.grey);
      //         Object.keys(error).forEach(function (key){
      //           ensureException(error[key]);
      //         });
      //         errorThrown = true;
      //     }
      //     assert.ok(errorThrown, message);
      //   });
      //   it("Should fail to initiate a vesting schedule because a _numTranches was not a whole factor of the associated totalAllocation ", async() => {
      //   });
      //   it("Create a vesting schedule for each of the employees", async() => {
      //   });
      //   it("Increment the vesting schedule for a specific employee", async() => {
      //   });
      //   it("Save vesting schedule for a specific employee in individualVestingDetails", async() => {
      //   });
      //   it("Send all tokens if no tokens already exist in the contract", async() => {
      //   });
      //   it("Send partial tokens if some of the required tokens already exist in the contract", async() => {
      //   });
      //   it("Send no tokens if the all of the required tokens already exist in the contract", async() => {
      //   });
      // })
      // context("Initiate Vesting Schedule From Template", async() => {
      //   it("Should fail to initiate a vesting schedule from template because the caller is not the owner", async() => {
      //   });
      //   it("Should fail to initiate a vesting schedule from template because an input target is 0", async() => {
      //   });
      //   it("Create a vesting schedule for an employee based on a template", async() => {
      //   });
      //   it("Create a vesting schedule for multiple employees based on a template", async() => {
      //   });
      //   it("Increment the vesting schedule for a specific employee", async() => {
      //   });
      //   it("Save vesting schedule for a specific employee in individualVestingDetails", async() => {
      //   });
      //   it("Send all tokens if no tokens already exist in the contract", async() => {
      //   });
      //   it("Send partial tokens if some of the required tokens already exist in the contract", async() => {
      //   });
      //   it("Send no tokens if the all of the required tokens already exist in the contract", async() => {
      //   });
      // })
      // context("Cancel Vesting Scheduel", async() => {
      //   it("Should fail to cancel a vesting schedule because the caller is not the owner", async() => {
      //   });
      //   it("Should fail to cancel a vesting schedule because it does not exist", async() => {
      //   });
      //   it("Should fail to cancel a vesting schedule because the contract does not have the required number of tokens to send to the employee", async() => {
      //   });
      //   it("Should fail to cancel a vesting schedule because the contract does not have the required number of tokens to send to the treasury", async() => {
      //   });
      //   it("Cancel a vesting schedule", async() => {
      //   });
      //   it("Delete the individualVestingDetails from storage", async() => {
      //   });
      //   it("Send vested, unclaimed tokens to the employee", async() => {
      //   });
      //   it("Send unvested tokens to the treasury if the issuer wants to reclaim them", async() => {
      //   });
      //   it("Keep tokens in the contract and update numExcessTokens if the issuer sets _isReclaiming false", async() => {
      //   });
      // })
      // context("Collect Vested Tokens", async() => {
      //   it("Should fail to collect because a vesting schedule does not exist", async() => {
      //   });
      //   it("Should fail to collect because there are no remaining tokens to claim", async() => {
      //   });
      //   it("Should fail to collect because the contract does not have the required number of tokens to send to the employee", async() => {
      //   });
      //   it("Send vested tokens to the employee", async() => {
      //   });
      //   it("Update the numClaimedVestedTokens for that employee's specific vesting schedule", async() => {
      //   });
      //   it("Update the numUnclaimedVestedTokens for that employee's specific vesting schedule", async() => {
      //   });
      //   it("Send vested, unclaimed tokens to the employee", async() => {
      //   });
      // })
      // context("Push Vested Tokens", async() => {
      //   it("Should fail to push because a vesting schedule does not exist", async() => {
      //   });
      //   it("Should fail to push because there are no remaining tokens to claim", async() => {
      //   });
      //   it("Should fail to push because the contract does not have the required number of tokens to send to the employee", async() => {
      //   });
      //   it("Send vested tokens to the employee", async() => {
      //   });
      //   it("Update the numClaimedVestedTokens for that employee's specific vesting schedule", async() => {
      //   });
      //   it("Update the numUnclaimedVestedTokens for that employee's specific vesting schedule", async() => {
      //   });
      //   it("Send vested, unclaimed tokens to the employee", async() => {
      //   });
      })
        // it("Buy some tokens for account_investor1 (1 ETH)", async() => {
        //     // Add the Investor in to the whitelist
        //
        //     let tx = await I_GeneralTransferManager.modifyWhitelist(
        //         account_investor1,
        //         latestTime(),
        //         latestTime(),
        //         latestTime() + duration.days(30),
        //         true,
        //         {
        //             from: account_issuer,
        //             gas: 500000
        //         });
        //
        //     assert.equal(tx.logs[0].args._investor.toLowerCase(), account_investor1.toLowerCase(), "Failed in adding the investor in whitelist");
        //
        //     // Jump time
        //     await increaseTime(5000);
        //
        //     // Mint some tokens
        //     await I_SecurityToken.mint(account_investor1, web3.utils.toWei('1', 'ether'), { from: token_owner });
        //
        //     assert.equal(
        //         (await I_SecurityToken.balanceOf(account_investor1)).toNumber(),
        //         web3.utils.toWei('1', 'ether')
        //     );
        // });
        //
        // it("Buy some tokens for account_investor2 (2 ETH)", async() => {
        //     // Add the Investor in to the whitelist
        //
        //     let tx = await I_GeneralTransferManager.modifyWhitelist(
        //         account_investor2,
        //         latestTime(),
        //         latestTime(),
        //         latestTime() + duration.days(30),
        //         true,
        //         {
        //             from: account_issuer,
        //             gas: 500000
        //         });
        //
        //     assert.equal(tx.logs[0].args._investor.toLowerCase(), account_investor2.toLowerCase(), "Failed in adding the investor in whitelist");
        //
        //     // Mint some tokens
        //     await I_SecurityToken.mint(account_investor2, web3.utils.toWei('2', 'ether'), { from: token_owner });
        //
        //     assert.equal(
        //         (await I_SecurityToken.balanceOf(account_investor2)).toNumber(),
        //         web3.utils.toWei('2', 'ether')
        //     );
        // });
        //
        // it("Should fail in creating the dividend", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(10);
        //     await I_PolyToken.getTokens(web3.utils.toWei('1.5', 'ether'), token_owner);
        //     try {
        //         let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because allowance = 0`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Should fail in creating the dividend", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() - duration.days(10);
        //     await I_PolyToken.approve(I_ERC20DividendCheckpoint.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     try {
        //         let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because maturity > expiry`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Should fail in creating the dividend", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime() - duration.days(2);
        //     let expiry = latestTime() - duration.days(1);
        //     try {
        //         let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because now > expiry`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Should fail in creating the dividend", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(10);
        //     try {
        //         let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, 0, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because token address is 0x`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Should fail in creating the dividend", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(10);
        //     try {
        //         let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, 0, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because amount < 0`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Create new dividend of POLY tokens", async() => {
        //     let maturity = latestTime() + duration.days(1);
        //     let expiry = latestTime() + duration.days(10);
        //
        //     let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     assert.equal(tx.logs[0].args._checkpointId.toNumber(), 1, "Dividend should be created at checkpoint 1");
        // });
        //
        // it("Investor 1 transfers his token balance to investor 2", async() => {
        //     await I_SecurityToken.transfer(account_investor2, web3.utils.toWei('1', 'ether'), {from: account_investor1});
        //     assert.equal(await I_SecurityToken.balanceOf(account_investor1), 0);
        //     assert.equal(await I_SecurityToken.balanceOf(account_investor2), web3.utils.toWei('3', 'ether'));
        // });
        //
        // it("Issuer pushes dividends iterating over account holders - dividends proportional to checkpoint", async() => {
        //     let errorThrown = false;
        //     try {
        //         await I_ERC20DividendCheckpoint.pushDividendPayment(0, 0, 10, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index has maturity in future`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Issuer pushes dividends iterating over account holders - dividends proportional to checkpoint", async() => {
        //     let errorThrown = false;
        //     // Increase time by 2 day
        //     await increaseTime(duration.days(2));
        //     try {
        //         await I_ERC20DividendCheckpoint.pushDividendPayment(0, 0, 10, {from: account_temp});
        //     } catch(error) {
        //         console.log(`       tx -> failed because msg.sender is not the owner`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Issuer pushes dividends iterating over account holders - dividends proportional to checkpoint", async() => {
        //     let errorThrown = false;
        //     try {
        //         await I_ERC20DividendCheckpoint.pushDividendPayment(2, 0, 10, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index is greator than the dividend array length`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Issuer pushes dividends iterating over account holders - dividends proportional to checkpoint", async() => {
        //     let _dev = await I_ERC20DividendCheckpoint.dividends.call(0);
        //     let investor1Balance = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2Balance = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     await I_ERC20DividendCheckpoint.pushDividendPayment(0, 0, 10, {from: token_owner, gas: 5000000});
        //     let investor1BalanceAfter = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     assert.equal(investor1BalanceAfter.sub(investor1Balance).toNumber(), web3.utils.toWei('0.5', 'ether'));
        //     assert.equal(investor2BalanceAfter.sub(investor2Balance).toNumber(), web3.utils.toWei('1', 'ether'));
        //     //Check fully claimed
        //     assert.equal((await I_ERC20DividendCheckpoint.dividends(0))[6].toNumber(), web3.utils.toWei('1.5', 'ether'));
        // });
        //
        // it("Buy some tokens for account_temp (1 ETH)", async() => {
        //     // Add the Investor in to the whitelist
        //
        //     let tx = await I_GeneralTransferManager.modifyWhitelist(
        //         account_temp,
        //         latestTime(),
        //         latestTime(),
        //         latestTime() + duration.days(20),
        //         true,
        //         {
        //             from: account_issuer,
        //             gas: 500000
        //         });
        //
        //     assert.equal(tx.logs[0].args._investor.toLowerCase(), account_temp.toLowerCase(), "Failed in adding the investor in whitelist");
        //
        //     // Mint some tokens
        //     await I_SecurityToken.mint(account_temp, web3.utils.toWei('1', 'ether'), { from: token_owner });
        //
        //     assert.equal(
        //         (await I_SecurityToken.balanceOf(account_temp)).toNumber(),
        //         web3.utils.toWei('1', 'ether')
        //     );
        // });
        //
        // it("Create new dividend", async() => {
        //     let maturity = latestTime() + duration.days(1);
        //     let expiry = latestTime() + duration.days(10);
        //     await I_PolyToken.getTokens(web3.utils.toWei('1.5', 'ether'), token_owner);
        //     await I_PolyToken.approve(I_ERC20DividendCheckpoint.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, web3.utils.toWei('1.5', 'ether'), {from: token_owner});
        //     assert.equal(tx.logs[0].args._checkpointId.toNumber(), 2, "Dividend should be created at checkpoint 1");
        // });
        //
        // it("Issuer pushes dividends iterating over account holders - dividends proportional to checkpoint", async() => {
        //     let errorThrown = false;
        //     await increaseTime(duration.days(12));
        //     try {
        //         await I_ERC20DividendCheckpoint.pushDividendPayment(1, 0, 10, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index has passed its expiry`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        //  it("Issuer pushes dividends iterating over account holders - dividends proportional to checkpoint", async() => {
        //     let errorThrown = false;
        //     let tx = await I_ERC20DividendCheckpoint.reclaimDividend(1, {from: token_owner, gas: 500000});
        //     assert.equal((tx.logs[0].args._claimedAmount).toNumber(), web3.utils.toWei("1.5", "ether"));
        //     try {
        //         await I_ERC20DividendCheckpoint.reclaimDividend(1, {from: token_owner, gas: 500000});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index has already reclaimed`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Buy some tokens for account_investor3 (7 ETH)", async() => {
        //     // Add the Investor in to the whitelist
        //
        //     let tx = await I_GeneralTransferManager.modifyWhitelist(
        //         account_investor3,
        //         latestTime(),
        //         latestTime(),
        //         latestTime() + duration.days(10),
        //         true,
        //         {
        //             from: account_issuer,
        //             gas: 500000
        //         });
        //
        //     assert.equal(tx.logs[0].args._investor.toLowerCase(), account_investor3.toLowerCase(), "Failed in adding the investor in whitelist");
        //
        //     // Mint some tokens
        //     await I_SecurityToken.mint(account_investor3, web3.utils.toWei('7', 'ether'), { from: token_owner });
        //
        //     assert.equal(
        //         (await I_SecurityToken.balanceOf(account_investor3)).toNumber(),
        //         web3.utils.toWei('7', 'ether')
        //     );
        // });
        //
        // it("Create another new dividend", async() => {
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(10);
        //     await I_PolyToken.getTokens(web3.utils.toWei('11', 'ether'), token_owner);
        //     await I_PolyToken.approve(I_ERC20DividendCheckpoint.address, web3.utils.toWei('11', 'ether'), {from: token_owner});
        //     let tx = await I_ERC20DividendCheckpoint.createDividend(maturity, expiry, I_PolyToken.address, web3.utils.toWei('11', 'ether'), {from: token_owner});
        //     assert.equal(tx.logs[0].args._checkpointId.toNumber(), 3, "Dividend should be created at checkpoint 2");
        // });
        //
        // it("should investor 3 claims dividend", async() => {
        //     let errorThrown = false;
        //     let investor1Balance = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2Balance = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3Balance = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     try {
        //         await I_ERC20DividendCheckpoint.pullDividendPayment(5, {from: account_investor3, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index is not valid`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("should investor 3 claims dividend", async() => {
        //     let investor1Balance = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2Balance = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3Balance = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     await I_ERC20DividendCheckpoint.pullDividendPayment(2, {from: account_investor3, gasPrice: 0});
        //     let investor1BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     assert.equal(investor1BalanceAfter1.sub(investor1Balance).toNumber(), 0);
        //     assert.equal(investor2BalanceAfter1.sub(investor2Balance).toNumber(), 0);
        //     assert.equal(investor3BalanceAfter1.sub(investor3Balance).toNumber(), web3.utils.toWei('7', 'ether'));
        // });
        //
        // it("should investor 3 claims dividend", async() => {
        //     let errorThrown = false;
        //     try {
        //         await I_ERC20DividendCheckpoint.pullDividendPayment(2, {from: account_investor3, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`       tx -> failed because investor already claimed the dividend`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("should issuer pushes remain", async() => {
        //     let investor1BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     await I_ERC20DividendCheckpoint.pushDividendPayment(2, 0, 10, {from: token_owner});
        //     let investor1BalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3BalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     assert.equal(investor1BalanceAfter2.sub(investor1BalanceAfter1).toNumber(), 0);
        //     assert.equal(investor2BalanceAfter2.sub(investor2BalanceAfter1).toNumber(), web3.utils.toWei('3', 'ether'));
        //     assert.equal(investor3BalanceAfter2.sub(investor3BalanceAfter1).toNumber(), 0);
        //     //Check fully claimed
        //     assert.equal((await I_ERC20DividendCheckpoint.dividends(2))[6].toNumber(), web3.utils.toWei('11', 'ether'));
        // });
        //
        // it("Investor 2 transfers 1 ETH of his token balance to investor 1", async() => {
        //     await I_SecurityToken.transfer(account_investor1, web3.utils.toWei('1', 'ether'), {from: account_investor2});
        //     assert.equal(await I_SecurityToken.balanceOf(account_investor1), web3.utils.toWei('1', 'ether'));
        //     assert.equal(await I_SecurityToken.balanceOf(account_investor2), web3.utils.toWei('2', 'ether'));
        //     assert.equal(await I_SecurityToken.balanceOf(account_investor3), web3.utils.toWei('7', 'ether'));
        // });
        //
        // it("Create another new dividend with explicit", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(2);
        //     let tx = await I_SecurityToken.createCheckpoint({from: token_owner});
        //     await I_PolyToken.getTokens(web3.utils.toWei('20', 'ether'), token_owner);
        //     try {
        //         tx = await I_ERC20DividendCheckpoint.createDividendWithCheckpoint(maturity, expiry, I_PolyToken.address, web3.utils.toWei('20', 'ether'), 4, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because allowance is not provided`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Create another new dividend with explicit", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() - duration.days(10);
        //     await I_PolyToken.approve(I_ERC20DividendCheckpoint.address, web3.utils.toWei('20', 'ether'), {from: token_owner});
        //     try {
        //         tx = await I_ERC20DividendCheckpoint.createDividendWithCheckpoint(maturity, expiry, I_PolyToken.address, web3.utils.toWei('20', 'ether'), 4, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because maturity > expiry`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Create another new dividend with explicit", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime() - duration.days(5);
        //     let expiry = latestTime() - duration.days(2);
        //     try {
        //         tx = await I_ERC20DividendCheckpoint.createDividendWithCheckpoint(maturity, expiry, I_PolyToken.address, web3.utils.toWei('20', 'ether'), 4, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because now > expiry`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Create another new dividend with explicit", async() => {
        //     let errorThrown = false;
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(2);
        //     try {
        //         tx = await I_ERC20DividendCheckpoint.createDividendWithCheckpoint(maturity, expiry, I_PolyToken.address, web3.utils.toWei('20', 'ether'), 5, {from: token_owner});
        //     } catch(error) {
        //         console.log(`       tx -> failed because checkpoint id > current checkpoint`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Create another new dividend with explicit", async() => {
        //     let maturity = latestTime();
        //     let expiry = latestTime() + duration.days(10);
        //     let tx = await I_SecurityToken.createCheckpoint({from: token_owner});
        //     await I_PolyToken.getTokens(web3.utils.toWei('11', 'ether'), token_owner);
        //     await I_PolyToken.approve(I_ERC20DividendCheckpoint.address, web3.utils.toWei('11', 'ether'), {from: token_owner});
        //     tx = await I_ERC20DividendCheckpoint.createDividendWithCheckpoint(maturity, expiry, I_PolyToken.address, web3.utils.toWei('11', 'ether'), 4, {from: token_owner});
        //     assert.equal(tx.logs[0].args._checkpointId.toNumber(), 4, "Dividend should be created at checkpoint 3");
        // });
        //
        // it("Investor 2 claims dividend, issuer pushes investor 1", async() => {
        //     let errorThrown = false;
        //     let investor1Balance = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2Balance = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3Balance = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     try {
        //         await I_ERC20DividendCheckpoint.pushDividendPaymentToAddresses(2, [account_investor2, account_investor1],{from: account_investor2, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`       tx -> failed because not called by the owner`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Investor 2 claims dividend, issuer pushes investor 1", async() => {
        //     let errorThrown = false;
        //     let investor1Balance = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2Balance = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3Balance = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     try {
        //         await I_ERC20DividendCheckpoint.pushDividendPaymentToAddresses(5, [account_investor2, account_investor1],{from: token_owner, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index is not valid`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("should calculate dividend before the push dividend payment", async() => {
        //     let dividendAmount1 = await I_ERC20DividendCheckpoint.calculateDividend.call(3, account_investor1);
        //     let dividendAmount2 = await I_ERC20DividendCheckpoint.calculateDividend.call(3, account_investor2);
        //     let dividendAmount3 = await I_ERC20DividendCheckpoint.calculateDividend.call(3, account_investor3);
        //     let dividendAmount_temp = await I_ERC20DividendCheckpoint.calculateDividend.call(3, account_temp);
        //     assert.equal(dividendAmount1.toNumber(), web3.utils.toWei("1", "ether"));
        //     assert.equal(dividendAmount2.toNumber(), web3.utils.toWei("2", "ether"));
        //     assert.equal(dividendAmount3.toNumber(), web3.utils.toWei("7", "ether"));
        //     assert.equal(dividendAmount_temp.toNumber(), web3.utils.toWei("1", "ether"));
        // });
        //
        // it("Investor 2 claims dividend", async() => {
        //     let investor1Balance = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2Balance = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3Balance = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     let tempBalance = BigNumber(await web3.eth.getBalance(account_temp));
        //     await I_ERC20DividendCheckpoint.pullDividendPayment(3, {from: account_investor2, gasPrice: 0});
        //     let investor1BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     let tempBalanceAfter1 = BigNumber(await web3.eth.getBalance(account_temp));
        //     assert.equal(investor1BalanceAfter1.sub(investor1Balance).toNumber(), 0);
        //     assert.equal(investor2BalanceAfter1.sub(investor2Balance).toNumber(), web3.utils.toWei('2', 'ether'));
        //     assert.equal(investor3BalanceAfter1.sub(investor3Balance).toNumber(), 0);
        //     assert.equal(tempBalanceAfter1.sub(tempBalance).toNumber(), 0);
        // });
        //
        // it("Should issuer pushes investor 1 and temp investor", async() => {
        //     let investor1BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3BalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     let tempBalanceAfter1 = BigNumber(await I_PolyToken.balanceOf(account_temp));
        //     await I_ERC20DividendCheckpoint.pushDividendPaymentToAddresses(3, [account_temp, account_investor1], {from: token_owner});
        //     let investor1BalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_investor1));
        //     let investor2BalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_investor2));
        //     let investor3BalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_investor3));
        //     let tempBalanceAfter2 = BigNumber(await I_PolyToken.balanceOf(account_temp));
        //     assert.equal(investor1BalanceAfter2.sub(investor1BalanceAfter1).toNumber(), web3.utils.toWei('1', 'ether'));
        //     assert.equal(investor2BalanceAfter2.sub(investor2BalanceAfter1).toNumber(), 0);
        //     assert.equal(investor3BalanceAfter2.sub(investor3BalanceAfter1).toNumber(), 0);
        //     assert.equal(tempBalanceAfter2.sub(tempBalanceAfter1).toNumber(), web3.utils.toWei('1', 'ether'));
        //     //Check fully claimed
        //     assert.equal((await I_ERC20DividendCheckpoint.dividends(3))[6].toNumber(), web3.utils.toWei('4', 'ether'));
        // });
        //
        // it("should calculate dividend after the push dividend payment", async() => {
        //     let dividendAmount1 = await I_ERC20DividendCheckpoint.calculateDividend.call(3, account_investor1);
        //     let dividendAmount2 = await I_ERC20DividendCheckpoint.calculateDividend.call(3, account_investor2);
        //     assert.equal(dividendAmount1.toNumber(), 0);
        //     assert.equal(dividendAmount2.toNumber(), 0);
        //  });
        //
        //  it("Issuer unable to reclaim dividend (expiry not passed)", async() => {
        //     let errorThrown = false;
        //     try {
        //         await I_ERC20DividendCheckpoint.reclaimDividend(3, {from: token_owner});
        //     } catch(error) {
        //         console.log(`Tx Failed because expiry is in the future ${0}. Test Passed Successfully`);
        //         errorThrown = true;
        //         ensureException(error);
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Issuer is able to reclaim dividend after expiry", async() => {
        //     let errorThrown = false;
        //     await increaseTime(11 * 24 * 60 * 60);
        //     try {
        //         await I_ERC20DividendCheckpoint.reclaimDividend(8, {from: token_owner, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend index is not valid`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Issuer is able to reclaim dividend after expiry", async() => {
        //     let tokenOwnerBalance = BigNumber(await I_PolyToken.balanceOf(token_owner));
        //     await I_ERC20DividendCheckpoint.reclaimDividend(3, {from: token_owner, gasPrice: 0});
        //     let tokenOwnerAfter = BigNumber(await I_PolyToken.balanceOf(token_owner));
        //     assert.equal(tokenOwnerAfter.sub(tokenOwnerBalance).toNumber(), web3.utils.toWei('7', 'ether'));
        // });
        //
        //
        // it("Issuer is able to reclaim dividend after expiry", async() => {
        //     let errorThrown = false;
        //     let tokenOwnerBalance = BigNumber(await I_PolyToken.balanceOf(token_owner));
        //     try {
        //         await I_ERC20DividendCheckpoint.reclaimDividend(3, {from: token_owner, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`       tx -> failed because dividend are already reclaimed`.grey);
        //         ensureException(error);
        //         errorThrown = true;
        //     }
        //     assert.ok(errorThrown, message);
        // });
        //
        // it("Investor 3 unable to pull dividend after expiry", async() => {
        //     let errorThrown = false;
        //     try {
        //         await I_ERC20DividendCheckpoint.pullDividendPayment(3, {from: account_investor3, gasPrice: 0});
        //     } catch(error) {
        //         console.log(`Tx Failed because expiry is in the past ${0}. Test Passed Successfully`);
        //         errorThrown = true;
        //         ensureException(error);
        //     }
        //     assert.ok(errorThrown, message);
        //
        // });
        //
        // it("Should give the right dividend index", async() => {
        //     let index = await I_ERC20DividendCheckpoint.getDividendIndex.call(3);
        //     assert.equal(index[0], 2);
        // });
        //
        // it("Should give the right dividend index", async() => {
        //     let index = await I_ERC20DividendCheckpoint.getDividendIndex.call(8);
        //     assert.equal(index.length, 0);
        // });
        //
        // it("Get the init data", async() => {
        //     let tx = await I_ERC20DividendCheckpoint.getInitFunction.call();
        //     assert.equal(web3.utils.toAscii(tx).replace(/\u0000/g, ''),0);
        // });
        //
        // it("Should get the listed permissions", async() => {
        //     let tx = await I_ERC20DividendCheckpoint.getPermissions.call();
        //     assert.equal(tx.length,1);
        // });
        //
        // describe("Test cases for the ERC20DividendCheckpointFactory", async() => {
        //     it("should get the exact details of the factory", async() => {
        //         assert.equal((await I_ERC20DividendCheckpointFactory.setupCost.call()).toNumber(), 0);
        //         assert.equal(await I_ERC20DividendCheckpointFactory.getType.call(), 4);
        //         assert.equal(web3.utils.toAscii(await I_ERC20DividendCheckpointFactory.getName.call())
        //                     .replace(/\u0000/g, ''),
        //                     "ERC20DividendCheckpoint",
        //                     "Wrong Module added");
        //         assert.equal(await I_ERC20DividendCheckpointFactory.getDescription.call(),
        //                     "Create ERC20 dividends for token holders at a specific checkpoint",
        //                     "Wrong Module added");
        //         assert.equal(await I_ERC20DividendCheckpointFactory.getTitle.call(),
        //                     "ERC20 Dividend Checkpoint",
        //                     "Wrong Module added");
        //         assert.equal(await I_ERC20DividendCheckpointFactory.getInstructions.call(),
        //                     "Create a ERC20 dividend which will be paid out to token holders proportional to their balances at the point the dividend is created",
        //                     "Wrong Module added");
        //         let tags = await I_ERC20DividendCheckpointFactory.getTags.call();
        //         assert.equal(tags.length, 3);
        //
        //     });
        // });

    });

});
