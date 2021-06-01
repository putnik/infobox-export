import {getConfig} from "./config";
import {getMonths, getMonthsGen} from "./months";
import {TimeGuess} from "./types/main";

/**
 * Returns an array of elements with duplicate values deleted
 */
export function unique( array: any[] ): any[] {
	const $ = require('jquery');
	return $.grep( array, function ( el: any, index: number ) {
		return index === $.inArray( el, array );
	} );
}

export function getRandomHex( min: number, max: number ): string {
	return ( Math.floor( Math.random() * ( max - min + 1 ) ) + min ).toString( 16 );
}

export function lowercaseFirst( value: string ): string {
	return value.substr( 0, 1 ).toLowerCase() + value.substr( 1 );
}

export function guessDateAndPrecision( timestamp: string ): TimeGuess {
	let dateParts = timestamp.match( getConfig( 're-century' ) );
	let isoDate;
	if ( dateParts ) {
		isoDate = new Date( 0 );
		isoDate.setFullYear( getConfig( 'centuries' ).indexOf( dateParts[ 1 ].toUpperCase() ) * 100 + 1 );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 7,
		};
	}

	dateParts = timestamp.match( getConfig( 're-month-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 2 ], 10 ), getMonths().indexOf( dateParts[ 1 ] ) ) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 10,
		};
	}

	dateParts = timestamp.match( getConfig( 're-text-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC(
			parseInt( dateParts[ 3 ], 10 ),
			getMonthsGen().indexOf( dateParts[ 2 ] ),
			parseInt( dateParts[ 1 ], 10 )
		) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 11,
		};
	}

	dateParts = timestamp.match( getConfig( 're-dot-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC(
			parseInt( dateParts[ 3 ], 10 ) < 100
				? 1900 + parseInt( dateParts[ 3 ], 10 )
				: parseInt( dateParts[ 3 ], 10 ),
			parseInt( dateParts[ 2 ], 10 ) - 1,
			parseInt( dateParts[ 1 ], 10 )
		) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 11,
		};
	}

	dateParts = timestamp.match( getConfig( 're-iso-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC(
			parseInt( dateParts[ 1 ], 10 ) < 100
				? 1900 + parseInt( dateParts[ 1 ], 10 )
				: parseInt( dateParts[ 1 ], 10 ),
			parseInt( dateParts[ 2 ], 10 ) - 1,
			parseInt( dateParts[ 3 ], 10 )
		) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 11,
		};
	}

	dateParts = timestamp.match( getConfig( 're-decade' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 1 ], 10 ), 0 ) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 8,
		};
	}

	dateParts = timestamp.match( getConfig( 're-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 1 ], 10 ), 0 ) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 9,
		};
	}

	if ( timestamp.match( getConfig( 're-present' ) ) ) {
		return {
			type: 'novalue',
		};
	}

	if ( timestamp.match( getConfig( 're-unknown' ) ) ) {
		return {
			type: 'somevalue',
		};
	}
}
