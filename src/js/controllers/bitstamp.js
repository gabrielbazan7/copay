'use strict';

angular.module('copayApp.controllers').controller('bitstampController', function($scope, lodash, storageService, bitstampService) {

  $scope.init = function() {
    storageService.getBitstampCredentials(function(err, credentials) {
      if (err || lodash.isEmpty(credentials)) return;
      $scope.credentials = true;
      bitstampService.setCredentials(JSON.parse(credentials));
      bitstampService.getUserTransactions(function(err, txs) {
        $scope.userTransactions = txs;
      });
    });
  };

  $scope.setCredentials = function(apiKey, customerID) {
    var credentials = {
      apiKey: apiKey,
      customerID: customerID
    }
    bitstampService.setCredentials(credentials);
    bitstampService.getAccountBalance(function(err, balance) {
      if (err) {
        $scope.error = 'WRONG CREDENTIALS';
        return;
      }
      $scope.balance = balance;
      storageService.setBitstampCredentials(JSON.stringify(credentials), function() {
        $scope.credentials = true;
      });
    })
  }

});
