import { parseRawQuantity } from "../src/text-parser";

const assert = require("assert");

const config = {
	"re-10_3": new RegExp( "thousand" ),
	"re-10_6": new RegExp( "million" ),
	"re-10_9": new RegExp( "billion" ),
	"re-10_12": new RegExp( "trillion" ),
};

describe("parseRawQuantity()", function() {
	describe("with forceInteger=true", function() {
		it( "should return amount for integer value", function () {
			const result = parseRawQuantity( config, "28300", true );
			assert.deepStrictEqual( result, {
				"amount": "28300",
			} );
		} );
		it( "should return integer amount for float value (comma)", function () {
			const result = parseRawQuantity( config, "28300,15", true );
			assert.deepStrictEqual( result, {
				"amount": "2830015",
			} );
		} );
		it( "should return integer amount for float value (dot)", function () {
			const result = parseRawQuantity( config, "28300.15", true );
			assert.deepStrictEqual( result, {
				"amount": "2830015",
			} );
		} );
	} );
	describe("without forceInteger=true", function() {
		it( "should return amount for integer value", function () {
			const result = parseRawQuantity( config, "28300" );
			assert.deepStrictEqual( result, {
				"amount": "28300",
			} );
		} );
		it( "should return amount for float value (comma)", function () {
			const result = parseRawQuantity( config, "28300,15" );
			assert.deepStrictEqual( result, {
				"amount": "28300.15",
			} );
		} );
		it( "should return amount for float value (dot)", function () {
			const result = parseRawQuantity( config, "28300.15" );
			assert.deepStrictEqual( result, {
				"amount": "28300.15",
			} );
		} );
		describe("for dash-separated range", function() {
			it( "should return integer amount if parities are same", function () {
				const result = parseRawQuantity( config, "103-113" );
				assert.deepStrictEqual( result, {
					"amount": "108",
					"bound": "5",
					"lowerBound": "103",
					"upperBound": "113",
				} );
			} );
			it( "should return float amount if parities are different", function () {
				const result = parseRawQuantity( config, "103-114" );
				assert.deepStrictEqual( result, {
					"amount": "108.5",
					"bound": "5.5",
					"lowerBound": "103",
					"upperBound": "114",
				} );
			} );
			xit( "should return float amount if bounds are float", function () {
				const result = parseRawQuantity( config, "103,5-114,5" );
				assert.deepStrictEqual( result, {
					"amount": "109.0",
					"bound": "5.5",
					"lowerBound": "103.5",
					"upperBound": "114.5",
				} );
			} );
		} );
		describe("for plus/minus-separated range", function() {
			it( "should return integer amount if bound is integer", function () {
				const result = parseRawQuantity( config, "108±5" );
				assert.deepStrictEqual( result, {
					"amount": "108",
					"bound": "5",
					"lowerBound": "103",
					"upperBound": "113",
				} );
			} );
			it( "should return float amount if bound is float", function () {
				const result = parseRawQuantity( config, "108±5,5" );
				assert.deepStrictEqual( result, {
					"amount": "108",
					"bound": "5.5",
					"lowerBound": "102.5",
					"upperBound": "113.5",
				} );
			} );
		} );
	} );
});