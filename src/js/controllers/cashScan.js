'use strict';

angular.module('copayApp.controllers').controller('cashScanController',
  function($rootScope, $timeout, $scope, $state, $ionicHistory, $log, gettextCatalog, lodash, ongoingProcess, profileService, walletService, txFormatService, bwcError, pushNotificationsService, bwcService, externalLinkService) {
    var wallet;
    var errors = bwcService.getErrors();
    $scope.error = null;
    $scope.walletDisabled = '#667';

    $scope.$on("$ionicView.beforeEnter", function(event, data) {
      updateAllWallets();
    });

    $scope.openExternalLink = function() {
      var url = 'https://bitpay.github.io/copay-recovery/';
      var optIn = true;
      var title = null;
      var message = gettextCatalog.getString('Open the recovery tool.');
      var okText = gettextCatalog.getString('Open');
      var cancelText = gettextCatalog.getString('Go Back');
      externalLinkService.open(url, optIn, title, message, okText, cancelText);
    };

    var goHome = function() {
      $ionicHistory.nextViewOptions({
        disableAnimate: true,
        historyRoot: true
      });
      $ionicHistory.clearHistory();
      $state.go('tabs.settings').then(function() {
        $state.transitionTo('tabs.home');
      });
    }

    var updateAllWallets = function() {
      var walletsBTC = profileService.getWallets({
        coin: 'btc',
        onlyComplete: true,
        network: 'livenet'
      });

      var walletsBCH = profileService.getWallets({
        coin: 'bch',
        network: 'livenet'
      });
      var xPubKeyIndex = lodash.indexBy(walletsBCH, "credentials.xPubKey");

      // Filter out already duplicated wallets
      walletsBTC = lodash.filter(walletsBTC, function(w) {
        return !xPubKeyIndex[w.credentials.xPubKey];
      });

      // Filter out non BIP44 wallets and read only wallets
      $scope.nonEligibleWallets = lodash.filter(walletsBTC, function(w) {
        return w.credentials.derivationStrategy != 'BIP44' || !w.canSign();
      });

      // Filter out non backed up wallets
      $scope.nonBackedUpWallets = lodash.filter(walletsBTC, function(w) {
        return w.needsBackup;
      });

      // Filter available for duplicate wallets
      $scope.availableWallets = lodash.filter(walletsBTC, function(w) {
        return w.credentials.derivationStrategy == 'BIP44' && w.canSign() && !w.needsBackup;
      })

      var i = $scope.availableWallets.length;
      var j = 0;
      lodash.each($scope.availableWallets, function(wallet) {
        walletService.getBalance(wallet, {
          coin: 'bch'
        }, function(err, balance) {
          if (err) {
            wallet.error = (err === 'WALLET_NOT_REGISTERED') ? gettextCatalog.getString('Wallet not registered') : bwcError.msg(err);
            $log.error(err);
            return;
          }

          wallet.error = null;
          wallet.bchBalance = txFormatService.formatAmountStr('bch', balance.availableAmount);
          if (++j == i) {
            //Done
            $timeout(function() {
              $rootScope.$apply();
            }, 10);
          }
        });
      });
    };

    $scope.duplicate = function(wallet) {
      $scope.error = null;
      $log.debug('Duplicating wallet for BCH:' + wallet.id + ':' + wallet.name);

      var opts = {};
      opts.name = wallet.name + '[BCH]';
      opts.m = wallet.m;
      opts.n = wallet.n;
      opts.myName = wallet.credentials.copayerName;
      opts.networkName = wallet.network;
      opts.coin = 'bch';
      opts.walletPrivKey = wallet.credentials.walletPrivKey;
      opts.compliantDerivation = wallet.credentials.compliantDerivation;


      function setErr(err, cb) {

        if (!cb) cb = function() {};

        $scope.error = bwcError.cb(err, gettextCatalog.getString('Could not duplicate'), function() {
          return cb(err);
        });
        $timeout(function() {
          $rootScope.$apply();
        }, 10);
      }

      function importOrCreate(cb) {
        walletService.getStatus(wallet, {}, function(err, status) {
          if (err) return cb(err);

          opts.singleAddress = status.wallet.singleAddress;

          // first try to import
          profileService.importExtendedPrivateKey(opts.extendedPrivateKey, opts, function(err, newWallet) {
            if (err && !(err instanceof errors.NOT_AUTHORIZED)) {
              return setErr(err, cb);
            }
            if (err) {
              // create and store a wallet
              return profileService.createWallet(opts, function(err, newWallet) {
                if (err) return setErr(err, cb);
                return cb(null, newWallet, true);
              });
            }
            return cb(null, newWallet);
          });
        });
      };

      // Multisig wallets? add Copayers
      function addCopayers(newWallet, isNew, cb) {
        if (!isNew) return cb();
        if (wallet.n == 1) return cb();

        $log.info('Adding copayers for BCH wallet config:' + wallet.m + '-' + wallet.n);

        walletService.copyCopayers(wallet, newWallet, function(err) {
          if (err) return setErr(err, cb);

          return cb();
        });
      };

      walletService.getKeys(wallet, function(err, keys) {
        if (err) {
          $scope.error = err;
          return $timeout(function() {
            $rootScope.$apply();
          }, 10);
        }
        opts.extendedPrivateKey = keys.xPrivKey;
        ongoingProcess.set('duplicatingWallet', true);
        importOrCreate(function(err, newWallet, isNew) {
          if (err) {
            ongoingProcess.set('duplicatingWallet', false);
            return;
          }
          walletService.updateRemotePreferences(newWallet);
          pushNotificationsService.updateSubscription(newWallet);

          addCopayers(newWallet, isNew, function(err) {
            ongoingProcess.set('duplicatingWallet', false);
            if (err)
              return setErr(err);

            if (isNew)
              walletService.startScan(newWallet, function() {});

            goHome();
          });
        });
      });
    }
  });
