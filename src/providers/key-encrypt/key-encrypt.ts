import { Injectable } from '@angular/core';
import { File } from '@ionic-native/file';
import BWC from 'bitcore-wallet-client';
import { Platform } from 'ionic-angular';
import { Logger } from '../logger/logger';
import { FileStorage } from '../persistence/storage/file-storage';
import { LocalStorage } from '../persistence/storage/local-storage';

import { ENC_KYS } from '../../constants';
@Injectable()
export class KeyEncryptProvider {
  constructor(
    private logger: Logger,
    private platform: Platform,
    private file: File
  ) {
    logger.info(`KeyEncryptProvider Constructor ${new Date().toString()}`);
  }

  init() {
    return new Promise<void>(resolve => {
      setTimeout(async () => {
        const storage = this.platform.is('cordova')
          ? new FileStorage(this.file, this.logger)
          : new LocalStorage(this.logger);

        const keys = await storage.get('keys'); // get key
        if (!keys) {
          this.logger.debug(`KeyEncryptProvider - no keys`);
          return resolve();
        }
        let decryptedKeys = this.tryDescryptKeys(JSON.stringify(keys));
        const encryptingKey2 = ENC_KYS[0]; // new encrypt key
        const encryptedKeys = BWC.sjcl.encrypt(encryptingKey2, decryptedKeys);

        await storage.set('keys', JSON.parse(encryptedKeys));
        this.logger.debug(`KeyEncryptProvider - encrypted and saved`);
        return resolve();
      }, 500);
    });
  }

  tryDescryptKeys(keys: string) {
    let decryptedKeys;
    ENC_KYS.every(value => {
      // this.logger.debug(`Trying with ${index}:${value}`);
      try {
        decryptedKeys = BWC.sjcl.decrypt(value, keys);
        // this.logger.debug(` #### >>> Decrypted with ${index}:${value}`);
        return false; // break;
      } catch {
        return true; // continue;
      }
    });
    // if (!decryptedKeys) {
    //   this.logger.debug(` #### >>> Not yet encrypted? ${decryptedKeys}`);
    // }
    return decryptedKeys || keys;
  }
}
