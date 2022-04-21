/* eslint-disable mocha/max-top-level-suites */
/* eslint-disable mocha/no-setup-in-describe */
/* eslint-disable no-tabs */

import { createTimeString, createTimeValueFromDate, guessDateAndPrecision } from '../src/parser/time';

const assert = require( 'assert' );

const grigorianCalendar = 'http://www.wikidata.org/entity/Q1985727';
const julianCalendar = 'http://www.wikidata.org/entity/Q1985786';

describe( 'createTimeString()', function () {
	const testDate = new Date( Date.UTC( 1999, 11, 28 ) );

	it( 'with precision=11 should return YYYY-MM-DD', function () {
		const result = createTimeString( testDate, 11 );
		assert.strictEqual( result, '1999-12-28T00:00:00Z' );
	} );
	it( 'with precision=10 should return YYYY-MM-00', function () {
		const result = createTimeString( testDate, 10 );
		assert.strictEqual( result, '1999-12-00T00:00:00Z' );
	} );
	it( 'with precision=9 should return YYYY-00-00', function () {
		const result = createTimeString( testDate, 9 );
		assert.strictEqual( result, '1999-00-00T00:00:00Z' );
	} );
	it( 'with precision=8 should return YYY0-00-00', function () {
		const result = createTimeString( testDate, 8 );
		assert.strictEqual( result, '1990-00-00T00:00:00Z' );
	} );
	it( 'with precision=7 should return YY00-00-00', function () {
		const result = createTimeString( testDate, 7 );
		assert.strictEqual( result, '1900-00-00T00:00:00Z' );
	} );
	it( 'with precision=6 should return Y000-00-00', function () {
		const result = createTimeString( testDate, 6 );
		assert.strictEqual( result, '1000-00-00T00:00:00Z' );
	} );
	it( 'with precision=5 should return 0000-00-00', function () {
		const result = createTimeString( testDate, 5 );
		assert.strictEqual( result, '0000-00-00T00:00:00Z' );
	} );
	it( 'with lower precision should also return 0000-00-00', function () {
		const result = createTimeString( testDate, 4 );
		assert.strictEqual( result, '0000-00-00T00:00:00Z' );
	} );
} );

describe( 'createTimeValueFromDate()', function () {
	describe( 'without parameters', function () {
		it( 'should return Grigorian YYYY-MM-DD for recent date', function () {
			const testDate = new Date( Date.UTC( 1999, 11, 28 ) );
			const result = createTimeValueFromDate( testDate );
			assert.deepStrictEqual( result, {
				time: '+1999-12-28T00:00:00Z',
				precision: 11,
				timezone: 0,
				before: 0,
				after: 0,
				calendarmodel: grigorianCalendar
			} );
		} );
		it( 'should return Julian YYYY-MM-DD for old date', function () {
			const testDate = new Date( Date.UTC( 1521, 11, 28 ) );
			const result = createTimeValueFromDate( testDate );
			assert.deepStrictEqual( result, {
				time: '+1521-12-28T00:00:00Z',
				precision: 11,
				timezone: 0,
				before: 0,
				after: 0,
				calendarmodel: julianCalendar
			} );
		} );
	} );
	it( 'with isBce=true should return Julian -YYYY-MM-DD', function () {
		const testDate = new Date( Date.UTC( 1999, 11, 28 ) );
		const result = createTimeValueFromDate( testDate, true );
		assert.deepStrictEqual( result, {
			time: '-1999-12-28T00:00:00Z',
			precision: 11,
			timezone: 0,
			before: 0,
			after: 0,
			calendarmodel: julianCalendar
		} );
	} );
	describe( 'with precision=9 should return YYYY-00-00', function () {
		const testDate = new Date( Date.UTC( 1999, 11, 28 ) );
		const result = createTimeValueFromDate( testDate, null, 9 );
		assert.deepStrictEqual( result, {
			time: '+1999-00-00T00:00:00Z',
			precision: 9,
			timezone: 0,
			before: 0,
			after: 0,
			calendarmodel: grigorianCalendar
		} );
	} );
	it( 'with forceJulian=true should return Julian YYYY-MM-DD for recent date', function () {
		const testDate = new Date( Date.UTC( 1999, 11, 28 ) );
		const result = createTimeValueFromDate( testDate, null, null, true );
		assert.deepStrictEqual( result, {
			time: '+1999-12-28T00:00:00Z',
			precision: 11,
			timezone: 0,
			before: 0,
			after: 0,
			calendarmodel: julianCalendar
		} );
	} );
} );

describe( 'guessDateAndPrecision()', function () {
	describe( 'should parse as day', function () {
		it( 'YYYY-MM-DD', function () {
			const result = guessDateAndPrecision( '1999-12-28' );
			assert.deepStrictEqual( result, {
				type: 'value',
				isoDate: new Date( '1999-12-28 00:00:00Z' ),
				precision: 11
			} );
		} );
		it( 'DD.MM.YYYY', function () {
			const result = guessDateAndPrecision( '28.12.1999' );
			assert.deepStrictEqual( result, {
				type: 'value',
				isoDate: new Date( '1999-12-28 00:00:00Z' ),
				precision: 11
			} );
		} );
		// it( 'DD month YYYY', function () {
		// 	const result = guessDateAndPrecision( '28 December 1999' );
		// 	assert.deepStrictEqual( result, {
		// 		type: 'value',
		// 		isoDate: new Date( '1999-12-28 00:00:00Z' ),
		// 		precision: 11
		// 	} );
		// } );
	} );
	describe( 'should parse as month', function () {
		it( 'MM.YYYY', function () {
			const result = guessDateAndPrecision( '12.1999' );
			assert.deepStrictEqual( result, {
				type: 'value',
				isoDate: new Date( '1999-12-01 00:00:00Z' ),
				precision: 10
			} );
		} );
		// it( 'month YYYY', function () {
		// 	const result = guessDateAndPrecision( 'December 1999' );
		// 	assert.deepStrictEqual( result, {
		// 		type: 'value',
		// 		isoDate: new Date( '1999-12-01 00:00:00Z' ),
		// 		precision: 10
		// 	} );
		// } );
	} );
	it( 'should parse YYYY as year', function () {
		const result = guessDateAndPrecision( '1999' );
		assert.deepStrictEqual( result, {
			type: 'value',
			isoDate: new Date( '1999-01-01 00:00:00Z' ),
			precision: 9
		} );
	} );
	// it( 'should parse YYY0s as decade', function () {
	// 	const result = guessDateAndPrecision( '1990s' );
	// 	assert.deepStrictEqual( result, {
	// 		type: 'value',
	// 		isoDate: new Date( '1999-01-01 00:00:00Z' ),
	// 		precision: 8
	// 	} );
	// } );
	it( 'should parse Roman numbers as century', function () {
		const result = guessDateAndPrecision( 'XIV' );
		assert.deepStrictEqual( result, {
			type: 'value',
			isoDate: new Date( '1301-01-01 00:00:00Z' ),
			precision: 7
		} );
	} );
} );
