import { parseRawQuantity } from '../src/parser/quantity';

const assert = require( 'assert' );

const config = {
	're-10_3': /thousand/,
	're-10_6': /million/,
	're-10_9': /billion/,
	're-10_12': /trillion/
};

describe( 'parseRawQuantity()', function () {
	describe( 'with forceInteger=true', function () {
		it( 'should return amount for integer value', function () {
			const result = parseRawQuantity( config, '28300', true );
			assert.deepStrictEqual( result, {
				amount: '28300',
				unit: '1'
			} );
		} );
		it( 'should return amount for integer value with space', function () {
			const result = parseRawQuantity( config, '28 300', true );
			assert.deepStrictEqual( result, {
				amount: '28300',
				unit: '1'
			} );
		} );
		it( 'should return integer amount for float value (comma)', function () {
			const result = parseRawQuantity( config, '28300,15', true );
			assert.deepStrictEqual( result, {
				amount: '2830015',
				unit: '1'
			} );
		} );
		it( 'should return integer amount for float value (dot)', function () {
			const result = parseRawQuantity( config, '28300.15', true );
			assert.deepStrictEqual( result, {
				amount: '2830015',
				unit: '1'
			} );
		} );
		it( 'should convert to integer after multiplying by 10^n', function () {
			const result = parseRawQuantity( config, '2.8×103', true );
			assert.deepStrictEqual( result, {
				amount: '2800',
				unit: '1'
			} );
		} );
	} );
	describe( 'without forceInteger=true', function () {
		it( 'should return amount for integer value', function () {
			const result = parseRawQuantity( config, '28300' );
			assert.deepStrictEqual( result, {
				amount: '28300',
				unit: '1'
			} );
		} );
		it( 'should return amount for float value (comma)', function () {
			const result = parseRawQuantity( config, '28300,15' );
			assert.deepStrictEqual( result, {
				amount: '28300.15',
				unit: '1'
			} );
		} );
		it( 'should return amount for float value (dot)', function () {
			const result = parseRawQuantity( config, '28300.15' );
			assert.deepStrictEqual( result, {
				amount: '28300.15',
				unit: '1'
			} );
		} );
		describe( 'for dash-separated range', function () {
			it( 'should return integer amount if parities are same', function () {
				const result = parseRawQuantity( config, '103-113' );
				assert.deepStrictEqual( result, {
					amount: '108',
					lowerBound: '103',
					upperBound: '113',
					unit: '1'
				} );
			} );
			it( 'should return float amount if parities are different', function () {
				const result = parseRawQuantity( config, '103-114' );
				assert.deepStrictEqual( result, {
					amount: '108.5',
					lowerBound: '103',
					upperBound: '114',
					unit: '1'
				} );
			} );
			xit( 'should return float amount if bounds are float', function () {
				const result = parseRawQuantity( config, '103,5-114,5' );
				assert.deepStrictEqual( result, {
					amount: '109.0',
					lowerBound: '103.5',
					upperBound: '114.5',
					unit: '1'
				} );
			} );
		} );
		describe( 'for plus/minus-separated range', function () {
			it( 'should return integer amount if bound is integer', function () {
				const result = parseRawQuantity( config, '108±5' );
				assert.deepStrictEqual( result, {
					amount: '108',
					lowerBound: '103',
					upperBound: '113',
					unit: '1'
				} );
			} );
			it( 'should return float amount if bound is float', function () {
				const result = parseRawQuantity( config, '108±5,5' );
				assert.deepStrictEqual( result, {
					amount: '108',
					lowerBound: '102.5',
					upperBound: '113.5',
					unit: '1'
				} );
			} );
		} );
		describe( 'for 10^n', function () {
			it( 'should process positive power', function () {
				const result = parseRawQuantity( config, '1.23456×103' );
				assert.deepStrictEqual( result, {
					amount: '1234.56',
					unit: '1'
				} );
			} );
			it( 'should process negative power', function () {
				const result = parseRawQuantity( config, '1234.56×10-3' );
				assert.deepStrictEqual( result, {
					amount: '1.23456',
					unit: '1'
				} );
			} );
		} );
	} );
} );
