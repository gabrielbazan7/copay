import { Injectable } from '@angular/core';
import BWC from 'bitcore-wallet-client';
import { Platform } from 'ionic-angular';
import { Logger } from '../logger/logger';
import { FileStorage } from '../persistence/storage/file-storage';
import { LocalStorage } from '../persistence/storage/local-storage';

// https://medium.com/javascript-in-plain-english/private-member-in-javascript-class-2359ef666aaf
const privateProps = new WeakMap();
@Injectable()
export class KeyEncryptProvider {
  constructor(
    private logger: Logger,
    private platform: Platform,
    private fileStorage: FileStorage,
    private localStorage: LocalStorage
  ) {
    logger.info(`KeyEncryptProvider Constructor ${new Date().toString()}`);
    // new key at the end
    privateProps.set(this, {
      STORAGE_ENCRYPTING_KEYS: [
        'asdfghjklpoiuytrewqazxcvbnjskawq',
        'poiqwerlkhjkasdfgiuwerhjabsdfgks',
        'agksdfkjg234587asdjkhfdsakhjg283'
      ]
    });
  }

  get STORAGE_ENCRYPTING_KEYS() {
    return privateProps.get(this).STORAGE_ENCRYPTING_KEYS;
  }
  set STORAGE_ENCRYPTING_KEYS(STORAGE_ENCRYPTING_KEYS) {
    privateProps.set(this, { STORAGE_ENCRYPTING_KEYS });
  }

  public init() {
    return new Promise<void>(resolve => {
      this.logger.debug('Running key encrypt provider init function');
      // if(1) return resolve();
      setTimeout(async () => {
        const storage = this.platform.is('cordova')
          ? this.fileStorage
          : this.localStorage;

        let keys = await storage.get('keys'); // get key

        if (!keys) {
          this.logger.debug('KeyEncryptProvider - no keys');
          return resolve();
        }
        let decryptedKeys = this.tryDescryptKeys(JSON.stringify(keys));
        const storageEncryptingKey = this.STORAGE_ENCRYPTING_KEYS[
          this.STORAGE_ENCRYPTING_KEYS.length - 1
        ]; // new encrypt key
        const encryptedKeys = BWC.sjcl.encrypt(
          storageEncryptingKey,
          decryptedKeys
        );
        this.logger.debug(
          `Storage encrypted with key number: ${this.STORAGE_ENCRYPTING_KEYS.length}`
        );
        await storage.set('keys', JSON.parse(encryptedKeys));
        return resolve();
      }, 500);
    });
  }

  private tryDescryptKeys(keys: string) {
    let decryptedKeys;
    this.STORAGE_ENCRYPTING_KEYS.every((value, index) => {
      try {
        decryptedKeys = BWC.sjcl.decrypt(value, keys);
        this.logger.debug(`Storage decrypted with key number: ${index + 1}`);
        return false; // break;
      } catch (err) {
        if (this.STORAGE_ENCRYPTING_KEYS.length - 1 === index) {
          // Failed on the last iteration
          if (err && err.message == "json decode: this isn't json!") {
            // TODO
          } else if (err && err.message == "ccm: tag doesn't match") {
            this.logger.debug(
              `Could not decrypt storage. Tested ${this.STORAGE_ENCRYPTING_KEYS.length} keys without success`
            );
            // TODO message to the user: this version is not compatible with your storage, please uppdate to the most recent version or contact support
          } else {
            this.logger.debug(`Not yet encrypted?`);
          }
        }
        return true; // continue;
      }
    });
    return decryptedKeys || keys;
  }

  public encryptKeys(keys): string {
    const encryptingKey = this.STORAGE_ENCRYPTING_KEYS[
      this.STORAGE_ENCRYPTING_KEYS.length - 1
    ];
    let encryptedKeys;
    try {
      encryptedKeys = BWC.sjcl.encrypt(encryptingKey, JSON.stringify(keys));
    } catch (error) {
      // something ? TODO
    }
    this.logger.debug(
      `Storage encrypted successfully with key number: ${this.STORAGE_ENCRYPTING_KEYS.length}`
    );
    return encryptedKeys;
  }

  public decryptKeys(encryptedKeys): string {
    const encryptingKey = this.STORAGE_ENCRYPTING_KEYS[
      this.STORAGE_ENCRYPTING_KEYS.length - 1
    ];
    let keys;
    try {
      keys = BWC.sjcl.decrypt(encryptingKey, JSON.stringify(encryptedKeys));
    } catch (error) {
      // something ? TODO
    }
    this.logger.debug(
      `Storage decrypted successfully with key number: ${this.STORAGE_ENCRYPTING_KEYS.length}`
    );
    return keys;
  }
}
