import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { Item, ItemSliding } from 'ionic-angular';

export type WalletItemAction = 'send' | 'receive';

@Component({
  selector: 'wallet-item',
  templateUrl: 'wallet-item.html'
})
export class WalletItem implements OnInit {
  @Input()
  wallet: any;

  @Output()
  action: EventEmitter<{
    wallet: any;
    action: WalletItemAction;
  }> = new EventEmitter();

  @ViewChild(Item)
  item: Item;

  @ViewChild(ItemSliding)
  slidingItem: ItemSliding;

  currency: string;
  lastKnownBalance: string;
  totalBalanceStr: string;

  ngOnInit() {
    this.currency = this.wallet.coin.toUpperCase();
  }

  getBalance() {
    const lastKnownBalance = this.getLastKownBalance();
    const totalBalanceStr =
      this.wallet.cachedStatus &&
      this.wallet.cachedStatus.totalBalanceStr &&
      this.wallet.cachedStatus.totalBalanceStr.replace(` ${this.currency}`, '');
    return totalBalanceStr || lastKnownBalance;
  }

  getLastKownBalance() {
    return (
      this.wallet.lastKnownBalance &&
      this.wallet.lastKnownBalance.replace(` ${this.currency}`, '')
    );
  }

  hasZeroBalance() {
    return (
      (this.wallet.cachedStatus &&
        this.wallet.cachedStatus.totalBalanceSat === 0) ||
      this.getLastKownBalance() === '0.00'
    );
  }

  performAction(action: WalletItemAction) {
    this.action.emit({
      wallet: this.wallet,
      action
    });
    this.slidingItem.close();
  }
}
