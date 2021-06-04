const mock = require('mock-require');

const jquery = require('./mocks/jquery');
mock( 'jquery', jquery.default );

const mw = require('./mocks/mw');
mock( 'mw', mw.default );

const oojs = require('./mocks/oojs');
mock( 'oojs', mw.default );

const ooui = require('./mocks/ooui');
mock( 'ooui', mw.default );
