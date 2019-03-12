import { Component } from '@angular/core';
import { NavController } from 'ionic-angular';
import { Logger } from '../../providers/logger/logger';

// pages
import { SelectCurrencyPage } from './select-currency/select-currency';

@Component({
  selector: 'page-add',
  templateUrl: 'add.html'
})
export class AddPage {
  constructor(private navCtrl: NavController, private logger: Logger) {}

  ionViewDidLoad() {
    this.logger.info('Loaded: AddPage');
  }

  public goToSelectCurrencyPage(isShared: boolean): void {
    this.navCtrl.push(SelectCurrencyPage, { isShared });
  }
}
