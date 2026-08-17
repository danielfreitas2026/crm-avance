const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const config = require('../knexfile');

for (const environment of ['development', 'production', 'test']) {
  test(`${environment} usa caminhos absolutos para migrations e seeds`, () => {
    const migrationsDirectory = config[environment].migrations.directory;
    const seedsDirectory = config[environment].seeds.directory;

    assert.equal(path.isAbsolute(migrationsDirectory), true);
    assert.equal(path.isAbsolute(seedsDirectory), true);
    assert.equal(fs.existsSync(migrationsDirectory), true);
    assert.equal(fs.existsSync(seedsDirectory), true);
  });
}
