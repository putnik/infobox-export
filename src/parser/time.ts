import { Reference, Snak, Statement } from '../types/wikidata/main';
import { getConfig } from '../config';
import { TimeValue, Value } from '../types/wikidata/values';
import { convertSnakToStatement, grigorianCalendar, julianCalendar } from '../wikidata';
import { TimeDataValue } from '../types/wikidata/datavalues';
import { getReferences } from './utils';
import { KeyValue, TimeGuess } from '../types/main';
import { getMonths, getMonthsGen } from '../months';

const startEndPropertyMapping: KeyValue = {
	P2031: 'P2032'
};

function guessDateAndPrecision( timestamp: string ): TimeGuess {
	let dateParts = timestamp.match( getConfig( 're-century' ) );
	let isoDate;
	if ( dateParts ) {
		isoDate = new Date( 0 );
		isoDate.setFullYear( getConfig( 'centuries' ).indexOf( dateParts[ 1 ].toUpperCase() ) * 100 + 1 );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 7
		};
	}

	dateParts = timestamp.match( getConfig( 're-month-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 2 ], 10 ), getMonths().indexOf( dateParts[ 1 ] ) ) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 10
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
			precision: 11
		};
	}

	dateParts = timestamp.match( getConfig( 're-dot-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC(
			parseInt( dateParts[ 3 ], 10 ) < 100 ?
				1900 + parseInt( dateParts[ 3 ], 10 ) :
				parseInt( dateParts[ 3 ], 10 ),
			parseInt( dateParts[ 2 ], 10 ) - 1,
			parseInt( dateParts[ 1 ], 10 )
		) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 11
		};
	}

	dateParts = timestamp.match( getConfig( 're-iso-date' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC(
			parseInt( dateParts[ 1 ], 10 ) < 100 ?
				1900 + parseInt( dateParts[ 1 ], 10 ) :
				parseInt( dateParts[ 1 ], 10 ),
			parseInt( dateParts[ 2 ], 10 ) - 1,
			parseInt( dateParts[ 3 ], 10 )
		) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 11
		};
	}

	dateParts = timestamp.match( getConfig( 're-decade' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 1 ], 10 ), 0 ) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 8
		};
	}

	dateParts = timestamp.match( getConfig( 're-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 1 ], 10 ), 0 ) );
		return {
			type: 'value',
			isoDate: isoDate,
			precision: 9
		};
	}

	if ( timestamp.match( getConfig( 're-present' ) ) ) {
		return {
			type: 'novalue'
		};
	}

	if ( timestamp.match( getConfig( 're-unknown' ) ) ) {
		return {
			type: 'somevalue'
		};
	}

	return {
		type: 'novalue'
	};
}

/**
 * Format dates as datavalue for Wikidata
 */
export function createTimeValue( timestamp: string, forceJulian: boolean | void ): TimeValue | void {
	if ( !timestamp ) {
		return;
	}
	const result: TimeValue = {
		time: '',
		precision: 0,
		timezone: 0,
		before: 0,
		after: 0,
		calendarmodel: grigorianCalendar
	};

	if ( timestamp.match( /\s\([^)]*\)\s/ ) ) {
		forceJulian = true;
	}
	timestamp = timestamp.replace( /\([^)]*\)/, '' ).trim();

	let isBce = false;
	const bceMatch = timestamp.match( getConfig( 're-bce' ) );
	if ( bceMatch ) {
		isBce = true;
		timestamp = timestamp.replace( bceMatch[ 0 ], '' ).trim();
	} else {
		const ceMatch = timestamp.match( getConfig( 're-ce' ) );
		if ( ceMatch ) {
			timestamp = timestamp.replace( ceMatch[ 0 ], '' ).trim();
		}
	}

	const guess: TimeGuess = guessDateAndPrecision( timestamp );
	if ( guess.type !== 'value' ) {
		return;
	}

	try {
		guess.isoDate.setUTCHours( 0 );
		guess.isoDate.setUTCMinutes( 0 );
		guess.isoDate.setUTCSeconds( 0 );

		result.time = ( isBce ? '-' : '+' ) + guess.isoDate.toISOString().replace( /\.000Z/, 'Z' );
		result.precision = guess.precision;
	} catch ( e ) {
		return;
	}
	if ( result.precision < 11 ) {
		result.time = result.time.replace( /-\d\dT/, '-00T' );
	}
	if ( result.precision < 10 ) {
		result.time = result.time.replace( /-\d\d-/, '-00-' );
	}

	if ( forceJulian || guess.isoDate < new Date( Date.UTC( 1582, 9, 15 ) ) ) {
		result.calendarmodel = julianCalendar;
	}

	return result;
}

function createTimeSnak( value: TimeValue, propertyId: string ): Snak {
	const dataValue: TimeDataValue = {
		value: value,
		type: 'time'
	};
	return {
		snaktype: 'value',
		property: propertyId,
		datavalue: dataValue,
		datatype: 'time'
	};
}

export function prepareTime( $content: JQuery, propertyId: string ): Statement[] {
	const statements: Statement[] = [];

	const timeText: string = $content.text().toLowerCase().trim().replace( getConfig( 're-year-postfix' ), '' );
	const isJulian: boolean = $content[ 0 ].outerHTML.includes( getConfig( 'mark-julian' ) );

	if ( timeText.match( /.{4,}[-−–—].{4,}/ ) && startEndPropertyMapping[ propertyId ] ) {
		const parts: string[] = timeText.split( /[-−–—]/ );
		if ( parts.length === 2 ) {
			const startDateValue: Value | void = createTimeValue( parts[ 0 ], isJulian );
			const endDateValue: Value | void = createTimeValue( parts[ 1 ], isJulian );
			if ( startDateValue && endDateValue ) {
				const references: Reference[] = getReferences( $content );

				const startDateSnak: Snak = createTimeSnak( startDateValue, propertyId );
				const startDateStatement: Statement = convertSnakToStatement( startDateSnak, references );
				statements.push( startDateStatement );

				const endDateSnak: Snak = createTimeSnak( endDateValue, startEndPropertyMapping[ propertyId ] );
				const endDateStatement: Statement = convertSnakToStatement( endDateSnak, references );
				statements.push( endDateStatement );

				return statements;
			}
		}
	}

	const value: TimeValue | void = createTimeValue( timeText, isJulian );
	if ( value ) {
		const snak: Snak = createTimeSnak( value, propertyId );
		const references: Reference[] = getReferences( $content );
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	}

	return statements;
}
