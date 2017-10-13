import { Injectable } from '@angular/core';
import { Logger } from '@nsalaun/ng-logger';

import { PlatformProvider } from '../platform/platform';
import { ConfigProvider } from '../config/config';
import { BwcProvider } from '../bwc/bwc';
import { TxFormatProvider } from '../tx-format/tx-format';
import { PersistenceProvider } from '../persistence/persistence';
import { BwcErrorProvider } from '../bwc-error/bwc-error';
import { RateProvider } from '../rate/rate';
import { FilterProvider } from '../filter/filter';
import { PopupProvider } from '../popup/popup';
import { OnGoingProcessProvider } from '../on-going-process/on-going-process';
import { TouchIdProvider } from '../touchid/touchid';

import * as lodash from 'lodash';


/* TODO LIST:
  - Bwc Error provider
  - onGoingProcess provider
*/


@Injectable()
export class WalletProvider {

  // Ratio low amount warning (fee/amount) in incoming TX
  private LOW_AMOUNT_RATIO: number = 0.15;

  // Ratio of "many utxos" warning in total balance (fee/amount)
  private TOTAL_LOW_WARNING_RATIO: number = .3;

  private WALLET_STATUS_MAX_TRIES: number = 7;
  private WALLET_STATUS_DELAY_BETWEEN_TRIES: number = 1.4 * 1000;
  private SOFT_CONFIRMATION_LIMIT: number = 12;
  private SAFE_CONFIRMATIONS: number = 6;

  private errors: any = this.bwc.getErrors();

  constructor(
    private logger: Logger,
    private platform: PlatformProvider,
    private bwc: BwcProvider,
    private txFormat: TxFormatProvider,
    private config: ConfigProvider,
    private persistence: PersistenceProvider,
    private bwcError: BwcErrorProvider,
    private rate: RateProvider,
    private filter: FilterProvider,
    private popup: PopupProvider,
    private ongoingProcess: OnGoingProcessProvider,
    private touchid: TouchIdProvider
  ) {
    console.log('Hello WalletService Provider');
  }



  private invalidateCache(wallet: any) {
    if (wallet.cachedStatus)
      wallet.cachedStatus.isValid = false;

    if (wallet.completeHistory)
      wallet.completeHistory.isValid = false;

    if (wallet.cachedActivity)
      wallet.cachedActivity.isValid = false;

    if (wallet.cachedTxps)
      wallet.cachedTxps.isValid = false;
  }

  getStatus(wallet: any, opts: any) {
    return new Promise((resolve, reject) => {
      opts = opts || {};
      var walletId = wallet.id;

      let processPendingTxps = (status: any) => {
        let txps = status.pendingTxps;
        let now = Math.floor(Date.now() / 1000);

        /* To test multiple outputs...
        var txp = {
          message: 'test multi-output',
          fee: 1000,
          createdOn: new Date() / 1000,
          outputs: []
        };
        function addOutput(n) {
          txp.outputs.push({
            amount: 600,
            toAddress: '2N8bhEwbKtMvR2jqMRcTCQqzHP6zXGToXcK',
            message: 'output #' + (Number(n) + 1)
          });
        };
        lodash.times(150, addOutput);
        txps.push(txp);
        */

        lodash.each(txps, (tx: any) => {

          tx = this.txFormat.processTx(wallet.coin, tx);

          // no future transactions...
          if (tx.createdOn > now)
            tx.createdOn = now;

          tx.wallet = wallet;

          if (!tx.wallet) {
            this.logger.error("no wallet at txp?");
            return;
          }

          let action: any = lodash.find(tx.actions, {
            copayerId: tx.wallet.copayerId
          });

          if (!action && tx.status == 'pending') {
            tx.pendingForUs = true;
          }

          if (action && action.type == 'accept') {
            tx.statusForUs = 'accepted';
          } else if (action && action.type == 'reject') {
            tx.statusForUs = 'rejected';
          } else {
            tx.statusForUs = 'pending';
          }

          if (!tx.deleteLockTime)
            tx.canBeRemoved = true;
        });
        wallet.pendingTxps = txps;
      };


      let get = (): Promise<any> => {
        return new Promise((resolve, reject) => {
          wallet.getStatus({
            twoStep: true
          }, (err, ret) => {
            if (err) {
              if (err instanceof this.errors.NOT_AUTHORIZED) {
                reject('WALLET_NOT_REGISTERED');
              }
              reject(err);
            }
            resolve(null);
          });
        })
      };

      let cacheBalance = (wallet: any, balance: any): void => {
        if (!balance) return;

        let configGet: any = this.config.get();
        let config: any = configGet.wallet;

        let cache = wallet.cachedStatus;

        // Address with Balance
        cache.balanceByAddress = balance.byAddress;

        // Total wallet balance is same regardless of 'spend unconfirmed funds' setting.
        cache.totalBalanceSat = balance.totalAmount;

        // Spend unconfirmed funds
        if (config.spendUnconfirmed) {
          cache.lockedBalanceSat = balance.lockedAmount;
          cache.availableBalanceSat = balance.availableAmount;
          cache.totalBytesToSendMax = balance.totalBytesToSendMax;
          cache.pendingAmount = 0;
          cache.spendableAmount = balance.totalAmount - balance.lockedAmount;
        } else {
          cache.lockedBalanceSat = balance.lockedConfirmedAmount;
          cache.availableBalanceSat = balance.availableConfirmedAmount;
          cache.totalBytesToSendMax = balance.totalBytesToSendConfirmedMax;
          cache.pendingAmount = balance.totalAmount - balance.totalConfirmedAmount;
          cache.spendableAmount = balance.totalConfirmedAmount - balance.lockedAmount;
        }

        // Selected unit
        cache.unitToSatoshi = config.settings.unitToSatoshi;
        cache.satToUnit = 1 / cache.unitToSatoshi;

        //STR
        cache.totalBalanceStr = this.txFormat.formatAmountStr(wallet.coin, cache.totalBalanceSat);
        cache.lockedBalanceStr = this.txFormat.formatAmountStr(wallet.coin, cache.lockedBalanceSat);
        cache.availableBalanceStr = this.txFormat.formatAmountStr(wallet.coin, cache.availableBalanceSat);
        cache.spendableBalanceStr = this.txFormat.formatAmountStr(wallet.coin, cache.spendableAmount);
        cache.pendingBalanceStr = this.txFormat.formatAmountStr(wallet.coin, cache.pendingAmount);

        cache.alternativeName = config.settings.alternativeName;
        cache.alternativeIsoCode = config.settings.alternativeIsoCode;

        // Check address
        this.isAddressUsed(wallet, balance.byAddress).then((used) => {
          if (used) {
            this.logger.debug('Address used. Creating new');
            // Force new address
            this.getAddress(wallet, true).then((addr) => {
              this.logger.debug('New address: ', addr);
            }).catch((err) => {
              reject(err);
            });
          }
        }).catch((err) => {
          reject(err);
        });

        this.rate.whenAvailable().then(() => {

          let totalBalanceAlternative = this.rate.toFiat(cache.totalBalanceSat, cache.alternativeIsoCode, wallet.coin);
          let pendingBalanceAlternative = this.rate.toFiat(cache.pendingAmount, cache.alternativeIsoCode, wallet.coin);
          let lockedBalanceAlternative = this.rate.toFiat(cache.lockedBalanceSat, cache.alternativeIsoCode, wallet.coin);
          let spendableBalanceAlternative = this.rate.toFiat(cache.spendableAmount, cache.alternativeIsoCode, wallet.coin);
          let alternativeConversionRate = this.rate.toFiat(100000000, cache.alternativeIsoCode, wallet.coin);

          cache.totalBalanceAlternative = this.filter.formatFiatAmount(totalBalanceAlternative);
          cache.pendingBalanceAlternative = this.filter.formatFiatAmount(pendingBalanceAlternative);
          cache.lockedBalanceAlternative = this.filter.formatFiatAmount(lockedBalanceAlternative);
          cache.spendableBalanceAlternative = this.filter.formatFiatAmount(spendableBalanceAlternative);
          cache.alternativeConversionRate = this.filter.formatFiatAmount(alternativeConversionRate);

          cache.alternativeBalanceAvailable = true;
          cache.isRateAvailable = true;
        });
      };

      let isStatusCached = (): any => {
        return wallet.cachedStatus && wallet.cachedStatus.isValid;
      };

      let cacheStatus = (status: any): void => {
        if (status.wallet && status.wallet.scanStatus == 'running') return;

        wallet.cachedStatus = status || {};
        let cache = wallet.cachedStatus;
        cache.statusUpdatedOn = Date.now();
        cache.isValid = true;
        cache.email = status.preferences ? status.preferences.email : null;
        cacheBalance(wallet, status.balance);
      };

      let walletStatusHash = (status: any): any => {
        return status ? status.balance.totalAmount : wallet.totalBalanceSat;
      };

      let _getStatus = (initStatusHash: any, tries: number): Promise<any> => {
        return new Promise((resolve, reject) => {
          if (isStatusCached() && !opts.force) {
            this.logger.debug('Wallet status cache hit:' + wallet.id);
            cacheStatus(wallet.cachedStatus);
            processPendingTxps(wallet.cachedStatus);
            resolve(wallet.cachedStatus);
          };

          tries = tries || 0;

          this.logger.debug('Updating Status:', wallet.credentials.walletName, tries);
          get().then((status) => {
            let currentStatusHash = walletStatusHash(status);
            this.logger.debug('Status update. hash:' + currentStatusHash + ' Try:' + tries);
            if (opts.untilItChanges && initStatusHash == currentStatusHash && tries < this.WALLET_STATUS_MAX_TRIES && walletId == wallet.credentials.walletId) {
              return setTimeout(() => {
                this.logger.debug('Retrying update... ' + walletId + ' Try:' + tries)
                return _getStatus(initStatusHash, ++tries);
              }, this.WALLET_STATUS_DELAY_BETWEEN_TRIES * tries);
            }

            processPendingTxps(status);

            this.logger.debug('Got Wallet Status for:' + wallet.credentials.walletName);

            cacheStatus(status);

            wallet.scanning = status.wallet && status.wallet.scanStatus == 'running';

            resolve(status);
          }).catch((err) => {
            reject(err);
          });

        });
      };

      _getStatus(walletStatusHash(null), 0);

    });
  }

  // Check address
  private isAddressUsed(wallet: any, byAddress: Array<any>): Promise<any> {
    return new Promise((resolve, reject) => {
      this.persistence.getLastAddress(wallet.id).then((addr) => {
        let used = lodash.find(byAddress, {
          address: addr
        });
        resolve(used);
      }).catch((err) => {
        reject(err);
      });
    });
  }

  private getAddress(wallet: any, forceNew: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      this.persistence.getLastAddress(wallet.id).then((addr) => {
        if (!forceNew && addr) resolve(addr);

        if (!wallet.isComplete())
          reject('WALLET_NOT_COMPLETE');

        this.createAddress(wallet).then((_addr) => {
          this.persistence.storeLastAddress(wallet.id, _addr).then(() => {
            resolve(_addr);
          }).catch((err) => {
            reject(err);
          });
        }).catch((err) => {
          reject(err);
        });
      }).catch((err) => {
        reject(err);
      });
    });
  }

  private createAddress(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Creating address for wallet:', wallet.id);

      wallet.createAddress({}, (err, addr) => {
        if (err) {
          let prefix = 'Could not create address'; //TODO Gettextcatalog
          if (err instanceof this.errors.CONNECTION_ERROR || (err.message && err.message.match(/5../))) {
            this.logger.warn(err);
            return setTimeout(() => {
              this.createAddress(wallet);
            }, 5000);
          } else if (err instanceof this.errors.MAIN_ADDRESS_GAP_REACHED || (err.message && err.message == 'MAIN_ADDRESS_GAP_REACHED')) {
            this.logger.warn(err);
            prefix = null;
            wallet.getMainAddresses({
              reverse: true,
              limit: 1
            }, (err, addr) => {
              if (err) reject(err);
              resolve(addr[0].address);
            });
          };
          this.bwcError.cb(err, prefix).then((msg) => {
            reject(msg);
          });
        };
        resolve(addr.address);
      });
    });
  }

  private getSavedTxs(walletId: string): Promise<any> {
    return new Promise((resolve, reject) => {

      this.persistence.getTxHistory(walletId).then((txs: any) => {
        let localTxs = [];

        if (!txs) {
          resolve(localTxs);
        };

        try {
          localTxs = JSON.parse(txs);
        } catch (ex) {
          this.logger.warn(ex);
        };
        resolve(lodash.compact(localTxs));
      }).catch((err: Error) => {
        reject(err);
      });
    });
  }

  private getTxsFromServer(wallet: any, skip: number, endingTxid: string, limit: number): Promise<any> {
    return new Promise((resolve, reject) => {
      let res = [];

      wallet.getTxHistory({
        skip: skip,
        limit: limit
      }, (err: Error, txsFromServer: Array<any>) => {
        if (err) reject(err);

        if (!txsFromServer.length)
          resolve();

        res = lodash.takeWhile(txsFromServer, (tx) => {
          return tx.txid != endingTxid;
        });

        let result = {
          res: res,
          shouldContinue: res.length >= limit
        };

        resolve(result);
      });
    });
  }

  private updateLocalTxHistory(wallet: any, opts: any) {
    return new Promise((resolve, reject) => {
      opts = opts ? opts : {};
      let FIRST_LIMIT = 5;
      let LIMIT = 50;
      let requestLimit = FIRST_LIMIT;
      let walletId = wallet.credentials.walletId;
      let progressFn = opts.progressFn || function () { };
      let foundLimitTx = [];


      if (opts.feeLevels) {
        opts.lowAmount = this.getLowAmount(wallet, opts.feeLevels);
      };

      let fixTxsUnit = (txs: any): void => {
        if (!txs || !txs[0] || !txs[0].amountStr) return;

        let cacheCoin: string = txs[0].amountStr.split(' ')[1];

        if (cacheCoin == 'bits') {

          this.logger.debug('Fixing Tx Cache Unit to: ' + wallet.coin)
          lodash.each(txs, (tx: any) => {
            tx.amountStr = this.txFormat.formatAmountStr(wallet.coin, tx.amount);
            tx.feeStr = this.txFormat.formatAmountStr(wallet.coin, tx.fees);
          });
        };
      };

      this.getSavedTxs(walletId).then((txsFromLocal: any) => {

        fixTxsUnit(txsFromLocal);

        var confirmedTxs = this.removeAndMarkSoftConfirmedTx(txsFromLocal);
        var endingTxid = confirmedTxs[0] ? confirmedTxs[0].txid : null;
        var endingTs = confirmedTxs[0] ? confirmedTxs[0].time : null;

        // First update
        progressFn(txsFromLocal, 0);
        wallet.completeHistory = txsFromLocal;

        let getNewTxs = (newTxs: Array<any>, skip: number): Promise<any> => {
          return new Promise((resolve, reject) => {
            this.getTxsFromServer(wallet, skip, endingTxid, requestLimit).then((result: any) => {

              var res = result.res;
              var shouldContinue = result.shouldContinue ? result.shouldContinue : false;

              newTxs = newTxs.concat(this.processNewTxs(wallet, lodash.compact(res)));
              progressFn(newTxs.concat(txsFromLocal), newTxs.length);
              skip = skip + requestLimit;
              this.logger.debug('Syncing TXs. Got:' + newTxs.length + ' Skip:' + skip, ' EndingTxid:', endingTxid, ' Continue:', shouldContinue);

              // TODO Dirty <HACK>
              // do not sync all history, just looking for a single TX.
              if (opts.limitTx) {
                foundLimitTx = lodash.find(newTxs, {
                  txid: opts.limitTx,
                });
                if (foundLimitTx) {
                  this.logger.debug('Found limitTX: ' + opts.limitTx);
                  resolve(foundLimitTx);
                }
              }
              // </HACK>
              if (!shouldContinue) {
                this.logger.debug('Finished Sync: New / soft confirmed Txs: ' + newTxs.length);
                resolve(newTxs);
              };

              requestLimit = LIMIT;
              getNewTxs(newTxs, skip);
            }).catch((err) => {
              this.logger.warn(this.bwcError.msg(err, 'Server Error')); //TODO
              if (err instanceof this.errors.CONNECTION_ERROR || (err.message && err.message.match(/5../))) {
                this.logger.info('Retrying history download in 5 secs...');
                reject(setTimeout(() => {
                  return getNewTxs(newTxs, skip);
                }, 5000));
              };
              reject(err);
            });
          });
        };

        getNewTxs([], 0).then((txs: any) => {

          let array: Array<any> = lodash.compact(txs.concat(confirmedTxs));
          let newHistory = lodash.uniqBy(array, (x: any) => {
            return x.txid;
          });


          let updateNotes = (): Promise<any> => {
            return new Promise((resolve, reject) => {
              if (!endingTs) resolve();

              this.logger.debug('Syncing notes from: ' + endingTs);
              wallet.getTxNotes({
                minTs: endingTs
              }, (err: any, notes: any) => {
                if (err) {
                  this.logger.warn(err);
                  reject(err);
                };
                lodash.each(notes, (note: any) => {
                  this.logger.debug('Note for ' + note.txid);
                  lodash.each(newHistory, (tx: any) => {
                    if (tx.txid == note.txid) {
                      this.logger.debug('...updating note for ' + note.txid);
                      tx.note = note;
                    };
                  });
                });
                resolve();
              });
            });
          };

          let updateLowAmount = (txs: any) => {
            if (!opts.lowAmount) return;

            lodash.each(txs, (tx: any) => {
              tx.lowAmount = tx.amount < opts.lowAmount;
            });
          };

          updateLowAmount(txs);

          updateNotes().then(() => {

            // <HACK>
            if (foundLimitTx) {
              this.logger.debug('Tx history read until limitTx: ' + opts.limitTx);
              resolve(newHistory);
            }
            // </HACK>

            var historyToSave = JSON.stringify(newHistory);
            lodash.each(txs, (tx: any) => {
              tx.recent = true;
            });
            this.logger.debug('Tx History synced. Total Txs: ' + newHistory.length);

            // Final update
            if (walletId == wallet.credentials.walletId) {
              wallet.completeHistory = newHistory;
            }

            return this.persistence.setTxHistory(historyToSave, walletId).then(() => {
              this.logger.debug('Tx History saved.');
              resolve();
            }).catch((err) => {
              reject(err);
            });
          }).catch((err) => {
            reject(err);
          });
        }).catch((err) => {
          reject(err);
        });
      }).catch((err) => {
        reject(err);
      });
    });
  }

  private processNewTxs(wallet: any, txs: any): Array<any> {
    let configGet: any = this.config.get();
    let config: any = configGet.wallet.settings;
    let now = Math.floor(Date.now() / 1000);
    let txHistoryUnique = {};
    let ret = [];
    wallet.hasUnsafeConfirmed = false;

    lodash.each(txs, (tx: any) => {
      tx = this.txFormat.processTx(wallet.coin, tx);

      // no future transactions...
      if (tx.time > now)
        tx.time = now;

      if (tx.confirmations >= this.SAFE_CONFIRMATIONS) {
        tx.safeConfirmed = this.SAFE_CONFIRMATIONS + '+';
      } else {
        tx.safeConfirmed = false;
        wallet.hasUnsafeConfirmed = true;
      };

      if (tx.note) {
        delete tx.note.encryptedEditedByName;
        delete tx.note.encryptedBody;
      };

      if (!txHistoryUnique[tx.txid]) {
        ret.push(tx);
        txHistoryUnique[tx.txid] = true;
      } else {
        this.logger.debug('Ignoring duplicate TX in history: ' + tx.txid)
      };
    });

    return ret;
  }

  private removeAndMarkSoftConfirmedTx(txs: any): Array<any> {
    return lodash.filter(txs, (tx: any) => {
      if (tx.confirmations >= this.SOFT_CONFIRMATION_LIMIT)
        return tx;
      tx.recent = true;
    });
  }

  // Approx utxo amount, from which the uxto is economically redeemable
  public getLowAmount(wallet: any, feeLevels: any, nbOutputs?: number) {
    let minFee: number = this.getMinFee(wallet, feeLevels, nbOutputs);
    return (minFee / this.LOW_AMOUNT_RATIO);
  }

  // Approx utxo amount, from which the uxto is economically redeemable
  private getMinFee(wallet: any, feeLevels: any, nbOutputs?: number): number {
    let level: any = lodash.find(feeLevels[wallet.network], {
      level: 'normal',
    });
    let lowLevelRate = parseInt((level.feePerKb / 1000).toFixed(0));

    var size = this.getEstimatedTxSize(wallet, nbOutputs);
    return size * lowLevelRate;
  }

  // These 2 functions were taken from
  // https://github.com/bitpay/bitcore-wallet-service/blob/master/lib/model/txproposal.js#L243
  private getEstimatedSizeForSingleInput(wallet: any): number {
    switch (wallet.credentials.addressType) {
      case 'P2PKH':
        return 147;
      default:
      case 'P2SH':
        return wallet.m * 72 + wallet.n * 36 + 44;
    };
  }

  private getEstimatedTxSize(wallet: any, nbOutputs?: number): number {
    // Note: found empirically based on all multisig P2SH inputs and within m & n allowed limits.
    nbOutputs = nbOutputs ? nbOutputs : 2; // Assume 2 outputs
    let safetyMargin = 0.02;
    let overhead = 4 + 4 + 9 + 9;
    let inputSize = this.getEstimatedSizeForSingleInput(wallet);
    let outputSize = 34;
    let nbInputs = 1; //Assume 1 input

    let size = overhead + inputSize * nbInputs + outputSize * nbOutputs;
    return parseInt((size * (1 + safetyMargin)).toFixed(0));
  }

  public getTxNote(wallet: any, txid: string): Promise<any> {
    return new Promise((resolve, reject) => {
      wallet.getTxNote({
        txid: txid
      }, (err: any, note: any) => {
        if (err) reject(err);
        resolve(note);
      });
    });
  }

  public editTxNote(wallet: any, args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      wallet.editTxNote(args, (err: any, res: any) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  public getTxp(wallet: any, txpid: string): Promise<any> {
    return new Promise((resolve, reject) => {
      wallet.getTx(txpid, (err: any, txp: any) => {
        if (err) reject(err);
        resolve(txp);
      });
    });
  }

  public getTx(wallet: any, txid: string) {
    return new Promise((resolve, reject) => {
      let finish = (list: any) => {
        let tx = lodash.find(list, {
          txid: txid
        });

        if (!tx) reject('Could not get transaction');
        resolve(tx);
      };

      if (wallet.completeHistory && wallet.completeHistory.isValid) {
        finish(wallet.completeHistory);
      } else {
        let opts = {
          limitTx: txid
        };
        this.getTxHistory(wallet, opts).then((txHistory: any) => {
          finish(txHistory);
        }).catch((err) => {
          reject(err);
        });
      };
    });
  }

  public getTxHistory(wallet: any, opts: any): Promise<any> {
    return new Promise((resolve, reject) => {
      opts = opts ? opts : {};
      let walletId = wallet.credentials.walletId;

      if (!wallet.isComplete()) resolve();

      let isHistoryCached = () => {
        return wallet.completeHistory && wallet.completeHistory.isValid;
      };

      if (isHistoryCached() && !opts.force) resolve(wallet.completeHistory);

      this.logger.debug('Updating Transaction History');
      this.updateLocalTxHistory(wallet, opts).then((txs: any) => {
        if (opts.limitTx) {
          resolve(txs);
        };

        wallet.completeHistory.isValid = true;
        resolve(wallet.completeHistory);
      }).catch((err) => {
        reject(err);
      });
    });
  }

  public isEncrypted(wallet: any) {
    if (lodash.isEmpty(wallet)) return;
    let isEncrypted = wallet.isPrivKeyEncrypted();
    if (isEncrypted) this.logger.debug('Wallet is encrypted');
    return isEncrypted;
  }

  public createTx(wallet: any, txp: any) {
    return new Promise((resolve, reject) => {
      if (lodash.isEmpty(txp) || lodash.isEmpty(wallet))
        reject('MISSING_PARAMETER');

      wallet.createTxProposal(txp, (err: any, createdTxp: any) => {
        if (err) reject(err);
        else {
          this.logger.debug('Transaction created');
          resolve(createdTxp);
        };
      });
    });
  }

  public publishTx(wallet: any, txp: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (lodash.isEmpty(txp) || lodash.isEmpty(wallet))
        reject('MISSING_PARAMETER');
      wallet.publishTxProposal({
        txp: txp
      }, (err: any, publishedTx: any) => {
        if (err) reject(err);
        else {
          this.logger.debug('Transaction published');
          resolve(publishedTx);
        };
      });
    });
  }

  signTx(wallet: any, txp: any, password: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!wallet || !txp)
        reject('MISSING_PARAMETER');

      try {
        wallet.signTxProposal(txp, password, (err: any, signedTxp: any) => {
          this.logger.debug('Transaction signed err:' + err);
          if (err) reject(err);
          resolve(signedTxp);
        });
      } catch (e) {
        this.logger.warn('Error at signTxProposal:', e);
        reject(e);
      };
    });
  }

  public broadcastTx(wallet: any, txp: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (lodash.isEmpty(txp) || lodash.isEmpty(wallet))
        reject('MISSING_PARAMETER');

      if (txp.status != 'accepted')
        reject('TX_NOT_ACCEPTED');

      wallet.broadcastTxProposal(txp, (err: any, broadcastedTxp: any, memo: any) => {
        if (err)
          reject(err);

        this.logger.debug('Transaction broadcasted');
        if (memo) this.logger.info(memo);

        resolve(broadcastedTxp);
      });
    });
  }

  public rejectTx(wallet: any, txp: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (lodash.isEmpty(txp) || lodash.isEmpty(wallet))
        reject('MISSING_PARAMETER');

      wallet.rejectTxProposal(txp, null, (err: any, rejectedTxp: any) => {
        if (err)
          reject(err);
        this.logger.debug('Transaction rejected');
        resolve(rejectedTxp);
      });
    });
  }

  public removeTx(wallet: any, txp: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (lodash.isEmpty(txp) || lodash.isEmpty(wallet))
        reject('MISSING_PARAMETER');

      wallet.removeTxProposal(txp, (err: any) => {
        this.logger.debug('Transaction removed');

        this.invalidateCache(wallet);
        // $rootScope.$emit('Local/TxAction', wallet.id);   
        resolve(err);
      });
    });
  }

  public updateRemotePreferences(clients: any, prefs: any): Promise<any> {
    return new Promise((resolve, reject) => {
      prefs = prefs || {};

      if (!lodash.isArray(clients))
        clients = [clients];

      let updateRemotePreferencesFor = (clients: any, prefs: any): Promise<any> => {
        return new Promise((resolve, reject) => {
          let wallet = clients.shift();
          if (!wallet) resolve();
          this.logger.debug('Saving remote preferences', wallet.credentials.walletName, prefs);

          wallet.savePreferences(prefs, (err: any) => {

            if (err) {
              this.popup.ionicAlert(this.bwcError.msg(err, 'Could not save preferences on the server')); //TODO Gettextcatalog
              reject(err);
            }

            updateRemotePreferencesFor(clients, prefs);
          });
        });
      };

      // Update this JIC.
      let config: any = this.config.get();
      let walletSettings = config.wallet.settings;

      //prefs.email  (may come from arguments)
      prefs.email = config.emailNotifications.email;
      prefs.language = "English" // This line was hardcoded - TODO: prefs.language = uxLanguage.getCurrentLanguage();
      // prefs.unit = walletSettings.unitCode; // TODO: remove, not used

      updateRemotePreferencesFor(lodash.clone(clients), prefs).then(() => {
        this.logger.debug('Remote preferences saved for' + lodash.map(clients, (x: any) => {
          return x.credentials.walletId;
        }).join(','));

        lodash.each(clients, (c: any) => {
          c.preferences = lodash.assign(prefs, c.preferences);
        });
        resolve();
      }).catch((err: any) => {
        reject(err);
      });
    });
  }

  public recreate(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Recreating wallet:', wallet.id);
      this.ongoingProcess.set('recreating', true);
      wallet.recreateWallet((err: any) => {
        wallet.notAuthorized = false;
        this.ongoingProcess.set('recreating', false);
        if (err) reject(err);
        resolve();
      });
    });
  }

  public startScan(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Scanning wallet ' + wallet.id);
      if (!wallet.isComplete()) reject();

      wallet.scanning = true;
      wallet.startScan({
        includeCopayerBranches: true,
      }, (err: any) => {
        if (err) reject(err);
        resolve();
      });
    });
  }


  public expireAddress(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Cleaning Address ' + wallet.id);
      this.persistence.clearLastAddress(wallet.id).then(() => {
        resolve();
      }).catch((err: any) => {
        reject(err);
      });
    });
  }

  public getMainAddresses(wallet: any, opts: any): Promise<any> {
    return new Promise((resolve, reject) => {
      opts = opts || {};
      opts.reverse = true;
      wallet.getMainAddresses(opts, (err, addresses) => {
        if (err) reject(err);
        resolve(addresses);
      });
    });
  }

  public getBalance(wallet: any, opts: any): Promise<any> {
    return new Promise((resolve, reject) => {
      opts = opts || {};
      wallet.getBalance(opts, (err, resp) => {
        if (err) reject(err);
        resolve(resp);
      });
    });
  }

  public getLowUtxos(wallet: any, levels: any): Promise<any> {
    return new Promise((resolve, reject) => {
      wallet.getUtxos({
        coin: wallet.coin
      }, (err, resp) => {
        if (err || !resp || !resp.length) reject(err);

        let minFee = this.getMinFee(wallet, levels, resp.length);

        let balance = lodash.sumBy(resp, 'satoshis');

        // for 2 outputs
        let lowAmount = this.getLowAmount(wallet, levels);
        let lowUtxos = lodash.filter(resp, (x: any) => {
          return x.satoshis < lowAmount;
        });

        let totalLow = lodash.sumBy(lowUtxos, 'satoshis');
        resolve({
          allUtxos: resp || [],
          lowUtxos: lowUtxos || [],
          warning: minFee / balance > this.TOTAL_LOW_WARNING_RATIO,
          minFee: minFee,
        });
      });
    });
  }

  public isReady(wallet: any): string {
    if (!wallet.isComplete())
      return 'WALLET_NOT_COMPLETE';
    if (wallet.needsBackup)
      return 'WALLET_NEEDS_BACKUP';
    return null;
  }

  // An alert dialog
  private askPassword(name: string, title: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.popup.ionicPrompt(title, name, null, null).then((res: any) => {
        resolve(res);
      }).catch((err: any) => {
        reject(err);
      });
    });
  };

  public encrypt(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      var title = 'Enter new spending password'; //TODO gettextcatalog
      var warnMsg = 'Your wallet key will be encrypted. The Spending Password cannot be recovered. Be sure to write it down.'; //TODO gettextcatalog
      this.askPassword(warnMsg, title).then((password: string) => {
        if (!password) reject('no password'); //TODO gettextcatalog
        title = 'Confirm your new spending password'; //TODO gettextcatalog
        this.askPassword(warnMsg, title).then((password2: string) => {
          if (!password2 || password != password2) reject('password mismatch');
          wallet.encryptPrivateKey(password);
          resolve();
        }).catch((err) => {
          reject(err);
        });
      }).catch((err) => {
        reject(err);
      });
    });

  };

  public decrypt(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.logger.debug('Disabling private key encryption for' + wallet.name);
      this.askPassword(null, 'Enter Spending Password').then((password: string) => {  //TODO gettextcatalog
        if (!password) reject('no password');
        try {
          wallet.decryptPrivateKey(password);
        } catch (e) {
          reject(e);
        }
        resolve();
      });
    });
  }

  public handleEncryptedWallet(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isEncrypted(wallet)) reject();
      this.askPassword(wallet.name, 'Enter Spending Password').then((password: string) => { //TODO gettextcatalog
        if (!password) reject('No password');
        if (!wallet.checkPassword(password)) reject('Wrong password');
        resolve(password);
      });
    });
  }

  public reject(wallet: any, txp: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.ongoingProcess.set('rejectTx', true);
      this.rejectTx(wallet, txp).then((txpr: any) => {
        this.invalidateCache(wallet);
        this.ongoingProcess.set('rejectTx', false);
        //$rootScope.$emit('Local/TxAction', wallet.id);
        resolve(txpr);
      }).catch((err) => {
        reject(err);
      });
    });
  }

  public onlyPublish(wallet: any, txp: any, customStatusHandler: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.ongoingProcess.set('sendingTx', true, customStatusHandler);
      this.publishTx(wallet, txp).then((publishedTxp) => {
        this.invalidateCache(wallet);
        this.ongoingProcess.set('sendingTx', false, customStatusHandler);
        //$rootScope.$emit('Local/TxAction', wallet.id);
        resolve();
      }).catch((err) => {
        reject(this.bwcError.msg(err));
      });
    });
  }

  public prepare(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.touchid.checkWallet(wallet).then(() => {
        this.handleEncryptedWallet(wallet).then((password: string) => {
          resolve(password);
        }).catch((err) => {
          reject(err);
        });
      }).catch((err) => {
        reject(err);
      });
    });
  }

  private signAndBroadcast(wallet: any, publishedTxp: any, password: any, customStatusHandler: any): Promise<any> {
    return new Promise((resolve, reject) => {

      this.ongoingProcess.set('signingTx', true, customStatusHandler);
      this.signTx(wallet, publishedTxp, password).then((signedTxp: any) => {
        this.ongoingProcess.set('signingTx', false, customStatusHandler);
        this.invalidateCache(wallet);
        if (signedTxp.status == 'accepted') {
          this.ongoingProcess.set('broadcastingTx', true, customStatusHandler);
          this.broadcastTx(wallet, signedTxp).then((broadcastedTxp: any) => {
            this.ongoingProcess.set('broadcastingTx', false, customStatusHandler);
            //$rootScope.$emit('Local/TxAction', wallet.id);
            resolve(broadcastedTxp);
          }).catch((err) => {
            reject(this.bwcError.msg(err));
          });
        } else {
          //$rootScope.$emit('Local/TxAction', wallet.id);
          resolve(signedTxp);
        };
      }).catch((err) => {
        this.logger.warn('sign error:' + err);
        let msg = err && err.message ? err.message : 'The payment was created but could not be completed. Please try again from home screen'; //TODO gettextcatalog
        //$rootScope.$emit('Local/TxAction', wallet.id);
        reject(msg);
      });
    });
  }

  public publishAndSign(wallet: any, txp: any, customStatusHandler: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // Already published?
      if (txp.status == 'pending') {
        this.prepare(wallet).then((password: string) => {
          this.signAndBroadcast(wallet, txp, password, customStatusHandler).then((broadcastedTxp: any) => {
            resolve(broadcastedTxp);
          }).catch((err) => {
            reject(err);
          });
        }).catch((err) => {
          reject(this.bwcError.msg(err));
        });
      } else {
        this.prepare(wallet).then((password: string) => {
          this.ongoingProcess.set('sendingTx', true, customStatusHandler);
          this.publishTx(wallet, txp).then((publishedTxp: any) => {
            this.ongoingProcess.set('sendingTx', false, customStatusHandler);
            this.signAndBroadcast(wallet, publishedTxp, password, customStatusHandler).then((broadcastedTxp: any) => {
              resolve(broadcastedTxp);
            }).catch((err) => {
              reject(err);
            });
          }).catch((err) => {
            this.ongoingProcess.set('sendingTx', false, customStatusHandler);
            reject(this.bwcError.msg(err));
          });
        }).catch((err) => {
          reject(this.bwcError.msg(err));
        });
      };
    });
  }

  public getEncodedWalletInfo(wallet: any, password: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let derivationPath = wallet.credentials.getBaseAddressDerivationPath();
      let encodingType = {
        mnemonic: 1,
        xpriv: 2,
        xpub: 3
      };
      let info: any = {};

      // not supported yet
      if (wallet.credentials.derivationStrategy != 'BIP44' || !wallet.canSign())
        reject('Exporting via QR not supported for this wallet'); //TODO gettextcatalog

      var keys = this.getKeysWithPassword(wallet, password);

      if (keys.mnemonic) {
        info = {
          type: encodingType.mnemonic,
          data: keys.mnemonic,
        }
      } else {
        info = {
          type: encodingType.xpriv,
          data: keys.xPrivKey
        }
      }

      resolve(info.type + '|' + info.data + '|' + wallet.credentials.network.toLowerCase() + '|' + derivationPath + '|' + (wallet.credentials.mnemonicHasPassphrase));
    });
  }

  public getKeysWithPassword(wallet: any, password: string): any {
    try {
      return wallet.getKeys(password);
    } catch (e) {
      this.logger.debug(e);
    }
  }

  public setTouchId(wallet: any, enabled: boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      var opts = {
        touchIdFor: {}
      };
      opts.touchIdFor[wallet.id] = enabled;

      this.touchid.checkWallet(wallet).then(() => {
        this.config.set(opts);
        resolve();
      }).catch((err) => {
        opts.touchIdFor[wallet.id] = !enabled;
        this.logger.debug('Error with fingerprint:' + err);
        this.config.set(opts);
        reject(err);
      });
    });
  }

  public getKeys(wallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.prepare(wallet).then((password: string) => {
        let keys;
        try {
          keys = wallet.getKeys(password);
        } catch (e) {
          reject(e);
        }
        resolve(keys);
      }).catch((err) => {
        reject(err);
      });
    });
  };

  public getSendMaxInfo(wallet: any, opts: any): Promise<any> {
    return new Promise((resolve, reject) => {
      opts = opts || {};
      wallet.getSendMaxInfo(opts, (err: any, res: any) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  };

  public getProtocolHandler(wallet: any): string {
    if (wallet.coin == 'bch') return 'bitcoincash';
    else return 'bitcoin';
  }

  public copyCopayers(wallet: any, newWallet: any): Promise<any> {
    return new Promise((resolve, reject) => {
      let walletPrivKey = this.bwc.getBitcore().PrivateKey.fromString(wallet.credentials.walletPrivKey);
      let copayer = 1;
      let i = 0;

      lodash.each(wallet.credentials.publicKeyRing, (item) => {
        let name = item.copayerName || ('copayer ' + copayer++);
        newWallet._doJoinWallet(newWallet.credentials.walletId, walletPrivKey, item.xPubKey, item.requestPubKey, name, {
          coin: newWallet.credentials.coin,
        }, (err: any) => {
          //Ignore error is copayer already in wallet
          if (err && !(err instanceof this.errors.COPAYER_IN_WALLET)) reject(err);
          if (++i == wallet.credentials.publicKeyRing.length) resolve();
        });
      });
    });
  };
}
