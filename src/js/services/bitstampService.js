'use strict';

angular.module('copayApp.services').factory('bitstampService', function($http, $log, $timeout, sjcl) {

  var root = {};
  root.credentials = {};

  root.setCredentials = function(credentials) {
    root.credentials.API = 'https://www.bitstamp.net/api/v2/';
    root.credentials.APIKEY = credentials.apiKey;
    root.credentials.CUSTOMERID = credentials.customerID;
  };

  root.getAccountBalance = function(cb) {

    var nonce = Date.now();
    var signature = sjcl.hash.sha256.hash(root.credentials.APIKEY + nonce + root.credentials.CUSTOMERID);

    var req = {
      method: 'POST',
      url: root.credentials.API + 'balance',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: {
        apiKey: root.credentials.APIKEY,
        signature: signature,
        nonce: nonce
      }
    };

    $http(req).then(function(data) {
      $log.info('SUCCESS Account balance request');
      return cb(null, data.data);
    }, function(data) {
      return cb(data.status);
    });
  };

  root.getUserTransactions = function(cb) {

    var nonce = Date.now();
    var signature = sjcl.hash.sha256.hash(root.credentials.APIKEY + nonce + root.credentials.CUSTOMERID);

    var req = {
      method: 'POST',
      url: root.credentials.API + 'user_transactions',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: {
        apiKey: root.credentials.APIKEY,
        signature: signature,
        nonce: nonce
      }
    };

    $http(req).then(function(data) {
      $log.info('SUCCESS user transactions request');
      return cb(null, data.data);
    }, function(data) {
      $log.error(data.reason);
      return cb(data.status);
    });
  };

  return root;

});
