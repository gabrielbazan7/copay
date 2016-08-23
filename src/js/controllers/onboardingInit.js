'use strict';
angular.module('copayApp.controllers').controller('onboardingStartedController',
  function($scope, $stateParams, $ionicSlideBoxDelegate) {

    $scope.init = function() {
      $scope.getStarted = false;
      $scope.data = {
        index: 0
      };
    };

    $scope.options = {
      loop: false,
      effect: 'flip',
      speed: 500,
      spaceBetween: 100
    }

    $scope.$on("$ionicSlides.sliderInitialized", function(event, data) {
      $scope.slider = data.slider;
    });

    $scope.$on("$ionicSlides.slideChangeStart", function(event, data) {
      $scope.data.index = data.slider.activeIndex;
      $scope.$apply();
    });

    $scope.$on("$ionicSlides.slideChangeEnd", function(event, data) {});
  });
