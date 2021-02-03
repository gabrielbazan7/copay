import BWC from 'bitcore-wallet-client';
import { TestUtils } from '../../test';
import { Logger } from '../logger/logger';
import { LocalStorage } from '../persistence/storage/local-storage';
import { KeyEncryptProvider } from './key-encrypt';

describe('KeyEncryptProvider', () => {
  let keyEncryptProvider: KeyEncryptProvider;
  let localStorage: LocalStorage;
  let logger: Logger;
  let loggerSpy;

  beforeEach(async () => {
    const testBed = TestUtils.configureProviderTestingModule();
    keyEncryptProvider = testBed.get(KeyEncryptProvider);
    localStorage = testBed.get(LocalStorage);
    logger = testBed.get(Logger);
    loggerSpy = spyOn(logger, 'debug');
  });

  describe('Init function', () => {
    it('should run init without errors if no keys to decrypt', async () => {
      keyEncryptProvider.STORAGE_ENCRYPTING_KEYS = [
        'asdfghjklpoiuytrewqazxcvbnjskawq'
      ];
      await keyEncryptProvider.init();
      expect(loggerSpy).toHaveBeenCalledWith(
        'Running key encrypt provider init function'
      );
      expect(loggerSpy).toHaveBeenCalledWith('KeyEncryptProvider - no keys');
      expect(loggerSpy).toHaveBeenCalledTimes(2);
    });

    it('should show an error if could not decrypt', async () => {
      keyEncryptProvider.STORAGE_ENCRYPTING_KEYS = [
        'poiqwerlkhjkasdfgiuwerhjabsdfgks',
        'asdfghjklpoiuytrewqazxcvbnjskawq'
      ];
      const encryptedKeys = BWC.sjcl.encrypt(
        'agksdfkjg234587asdjkhfdsakhjg283',
        JSON.stringify({ key: 'key1' })
      );
      spyOn(localStorage, 'get').and.returnValue(
        Promise.resolve(JSON.parse(encryptedKeys))
      );
      await keyEncryptProvider.init();
      expect(loggerSpy).toHaveBeenCalledWith(
        'Running key encrypt provider init function'
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Could not decrypt storage. Tested 2 keys without success'
      );
    });

    it('should encrypt keys that are not yet encrypted', async () => {
      keyEncryptProvider.STORAGE_ENCRYPTING_KEYS = [
        'asdfghjklpoiuytrewqazxcvbnjskawq'
      ];
      const spy = spyOn(localStorage, 'get').and.returnValue(
        Promise.resolve({ key: 'key1' })
      );
      await keyEncryptProvider.init();
      expect(loggerSpy).toHaveBeenCalledWith(
        'Running key encrypt provider init function'
      );
      expect(loggerSpy).toHaveBeenCalledWith('Not yet encrypted?');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Storage encrypted with key number: 1'
      );
      spy.and.callThrough();
      const keys = await localStorage.get('keys');
      const decryptedKeys = BWC.sjcl.decrypt(
        'asdfghjklpoiuytrewqazxcvbnjskawq',
        JSON.stringify(keys)
      );
      expect(JSON.parse(decryptedKeys)).toEqual({ key: 'key1' });
    });

    it('should try to decrypt keys with all encrypting keys till find the correct one and encrypt with the last one', async () => {
      keyEncryptProvider.STORAGE_ENCRYPTING_KEYS = [
        'agksdfkjg234587asdjkhfdsakhjg283',
        'poiqwerlkhjkasdfgiuwerhjabsdfgks',
        'asdfghjklpoiuytrewqazxcvbnjskawq'
      ];
      const encryptedKeys = BWC.sjcl.encrypt(
        'poiqwerlkhjkasdfgiuwerhjabsdfgks',
        JSON.stringify({ key: 'key1' })
      );
      let spy = spyOn(localStorage, 'get').and.returnValue(
        Promise.resolve(JSON.parse(encryptedKeys))
      );
      await keyEncryptProvider.init();
      expect(loggerSpy).toHaveBeenCalledWith(
        'Running key encrypt provider init function'
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Storage decrypted with key number: 2'
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        `Storage encrypted with key number: ${keyEncryptProvider.STORAGE_ENCRYPTING_KEYS.length}`
      );
      spy.and.callThrough();
      const keys = await localStorage.get('keys');
      const decryptedKeys = BWC.sjcl.decrypt(
        'asdfghjklpoiuytrewqazxcvbnjskawq',
        JSON.stringify(keys)
      );
      expect(JSON.parse(decryptedKeys)).toEqual({ key: 'key1' });
    });
  });

  describe('Decrypt and Encrypt function', () => {
    it('should decrypt correctly', () => {
      keyEncryptProvider.STORAGE_ENCRYPTING_KEYS = [
        'agksdfkjg234587asdjkhfdsakhjg283'
      ];
      const encryptedKeys = BWC.sjcl.encrypt(
        'agksdfkjg234587asdjkhfdsakhjg283',
        JSON.stringify({ key: 'key1' })
      );
      const decryptedKeys = keyEncryptProvider.decryptKeys(
        JSON.parse(encryptedKeys)
      );
      expect(JSON.parse(decryptedKeys)).toEqual({ key: 'key1' });
      expect(loggerSpy).toHaveBeenCalledWith(
        'Storage decrypted successfully with key number: 1'
      );
    });

    it('should encrypt correctly', () => {
      keyEncryptProvider.STORAGE_ENCRYPTING_KEYS = [
        'agksdfkjg234587asdjkhfdsakhjg283'
      ];
      const encryptedKeys = keyEncryptProvider.encryptKeys({ key: 'key1' });
      const decryptedKeys = BWC.sjcl.decrypt(
        'agksdfkjg234587asdjkhfdsakhjg283',
        encryptedKeys
      );
      expect(JSON.parse(decryptedKeys)).toEqual({ key: 'key1' });
      expect(loggerSpy).toHaveBeenCalledWith(
        'Storage encrypted successfully with key number: 1'
      );
    });
  });
});
