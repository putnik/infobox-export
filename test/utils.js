import { set } from "../src/utils";

const assert = require( "assert" );

describe( "set() should set the value ", function () {
	it( "for simple path", function () {
		const testObject = {};
		set( testObject, 'simplePath', 'simpleValue' );
		assert.deepStrictEqual( testObject, {
			"simplePath": "simpleValue"
		} );
	} );
	it( "for dot-separated path", function () {
		const testObject = {};
		set( testObject, 'dot.separated.path', 'simpleValue' );
		assert.deepStrictEqual( testObject, {
			"dot": {
				"separated": {
					"path": "simpleValue"
				}
			}
		} );
	} );
	it( "even if the inner object already contains a value", function () {
		const testObject = {
			"value": {
				"object": {
					"stringValue": "simpleValue"
				}
			}
		};
		set( testObject, 'value.object.numericValue', 2000 );
		assert.deepStrictEqual( testObject, {
			"value": {
				"object": {
					"stringValue": "simpleValue",
					"numericValue": 2000
				}
			}
		} );
	} );
	it( "even if there is conflict in the path", function () {
		const testObject = {
			"value": {
				"object": 1000
			}
		};
		set( testObject, 'value.object.numericValue', 2000 );
		assert.deepStrictEqual( testObject, {
			"value": {
				"object": {
					"numericValue": 2000
				}
			}
		} );
	} );
} );

