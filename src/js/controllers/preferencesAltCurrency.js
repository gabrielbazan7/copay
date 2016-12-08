'use strict';

angular.module('copayApp.controllers').controller('preferencesAltCurrencyController',
  function($scope, $log, $timeout, $ionicHistory, gettextCatalog, configService, rateService, lodash, profileService, walletService, storageService) {

    var next = 10;
    var completeAlternativeList;

    var unusedCurrencyList = [{
      isoCode: 'LTL'
    }, {
      isoCode: 'BTC'
    }];

    var config = configService.getSync();
    $scope.currentCurrency = config.wallet.settings.alternativeIsoCode;
    $scope.listComplete = false;

    rateService.whenAvailable(function() {
      storageService.getLastCurrencyUsed(function(err, lastUsedAltCurrency) {

        $scope.lastUsedAltCurrencyList = JSON.parse(lastUsedAltCurrency) || [];

        var idx = lodash.indexBy(unusedCurrencyList, 'isoCode');
        var idx2 = lodash.indexBy($scope.lastUsedAltCurrencyList, 'isoCode');

        completeAlternativeList = lodash.reject(rateService.listAlternatives(), function(c) {
          return idx[c.isoCode] || idx2[c.isoCode];
        });
        $scope.altCurrencyList = completeAlternativeList.slice(0, next);
      });
    });

    $scope.loadMore = function() {
      $timeout(function() {
        $scope.altCurrencyList = completeAlternativeList.slice(0, next);
        next += 10;
        $scope.listComplete = $scope.altCurrencyList.length >= completeAlternativeList.length;
        $scope.$broadcast('scroll.infiniteScrollComplete');
      }, 100);
    };

    $scope.save = function(newAltCurrency) {
      var opts = {
        wallet: {
          settings: {
            alternativeName: newAltCurrency.name,
            alternativeIsoCode: newAltCurrency.isoCode,
          }
        }
      };

      configService.set(opts, function(err) {
        if (err) $log.warn(err);

        $ionicHistory.goBack();
        saveLastUsed(newAltCurrency);
        walletService.updateRemotePreferences(profileService.getWallets(), {}, function() {
          $log.debug('Remote preferences saved');
        });
      });
    };

    function saveLastUsed(newAltCurrency) {
      $scope.lastUsedAltCurrencyList.unshift(newAltCurrency);
      $scope.lastUsedAltCurrencyList = $scope.lastUsedAltCurrencyList.slice(0, 3);
      $scope.lastUsedAltCurrencyList = lodash.uniq($scope.lastUsedAltCurrencyList, 'isoCode');
      storageService.setLastCurrencyUsed(JSON.stringify($scope.lastUsedAltCurrencyList), function() {});
    };

  });
