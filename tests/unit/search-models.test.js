describe('policy search model registration', () => {
  test('registers related models used by populate', () => {
    jest.isolateModules(() => {
      const isolatedMongoose = require('mongoose');
      require('../../src/modules/policies/policy.service');
      expect(isolatedMongoose.modelNames()).toEqual(
        expect.arrayContaining(['Agent', 'Account', 'Lob', 'Carrier', 'User', 'Policy']),
      );
    });
  });
});
