import { Component, Input } from '@angular/core';
import { CurrencyProvider } from '../../providers/currency/currency';
@Component({
  selector: 'coin-icon',
  templateUrl: 'coin-icon.html'
})
export class CoinIconComponent {
  @Input()
  coin: string;
  @Input()
  network: string;

  constructor(public currencyProvider: CurrencyProvider) {}
}
