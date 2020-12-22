import { Injectable } from '@angular/core';
import { Logger } from '../logger/logger';
import { File } from '@ionic-native/file';
import { Platform } from 'ionic-angular';
import { FileStorage } from '../persistence/storage/file-storage';
import { LocalStorage } from '../persistence/storage/local-storage';
import BWC from 'bitcore-wallet-client';

@Injectable()
export class AppInitService {
  private readonly log_prefix: string;
  constructor(protected logger: Logger, private platform: Platform, private file: File) {
    this.log_prefix = "##### >>> AppInit";
    logger.info(`AppInitService Constructor ${(new Date()).toString()}`);
  }
  Log(data: string) {
    this.logger.info(`${this.log_prefix} ${data} - ${(new Date()).toString()}`);
  }

  Init() {
    return new Promise<void>(async (resolve) => {
      setTimeout(async () => {
        const storage = this.platform.is('cordova') ?
          new FileStorage(this.file, this.logger)
          : new LocalStorage(this.logger);

        const keys = await storage.get('keys'); // get key
        // this.debug(`${this.log_prefix} - AppInitService Finished: ${JSON.stringify(keys)}`);
        if (!keys) return Promise.resolve();
        let encryptingKey1 = 'asdfghjklpoiuytrewqazxcvbnjskawq'; // old encryption key
        var decryptedKeys;
        try {
          decryptedKeys = BWC.sjcl.decrypt(encryptingKey1, JSON.stringify(keys));
        } catch (err) {
          this.logger.debug(`${this.log_prefix} - Not yet encrypted?`);
          decryptedKeys = keys;
        }
        var encryptingKey2 = 'asdfghjklpoiuytrewqazxcvbnjskawq'; // new encrypt key
        var encryptedKeys = BWC.sjcl.encrypt(
          encryptingKey2,
          JSON.stringify(decryptedKeys)
        );
        await storage.set('keys', encryptedKeys);
        // this.debug(`${this.log_prefix} - AppInitService Finished!`);
        resolve();
      }, 1000);

    });
  }
}