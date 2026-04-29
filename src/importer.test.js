
describe('importer',() => {
  it('imports the module correctly', () => {
    const { validateFromFile } = require('./validator');
    expect(validateFromFile).toBeTruthy();
  });
});