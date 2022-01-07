import { Reference, Snak, Statement } from '../types/wikidata/main';
import { getConfig } from '../config';
import { TimeValue, Value } from '../types/wikidata/values';
import { convertSnakToStatement, createNovalueSnak, grigorianCalendar, julianCalendar } from '../wikidata';
import { TimeDataValue } from '../types/wikidata/datavalues';
import { getReferences } from './utils';
import { Context, KeyValue, TimeGuess } from '../types/main';
import { getMonths, getMonthsGen } from '../months';
import { PropertyId } from '../types/wikidata/types';

const startEndPropertyMapping: KeyValue = {
	P571: 'P576',
	P580: 'P582',
	P2031: 'P2032'
};

export function guessDateAndPrecision( timestamp: string ): TimeGuess {
	let dateParts = timestamp.match( getConfig( 're-century' ) );
	let isoDate;
	if ( dateParts ) {
		isoDate = new Date( 0 );
		isoDate.setFullYear( getConfig( 'centuries' ).indexOf( dateParts[ 1 ].toUpperCase() ) * 100 + 1 );
		isoDate.setUTCHours( 0 );
		isoDate.setUTCMinutes( 0 );
		isoDate.setUTCSeconds( 0 );

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

	dateParts = timestamp.match( getConfig( 're-month-dot-year' ) );
	if ( dateParts ) {
		isoDate = new Date( Date.UTC( parseInt( dateParts[ 2 ], 10 ), parseInt( dateParts[ 1 ], 10 ) - 1 ) );
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
		type: 'somevalue'
	};
}

export function createTimeString( time: Date, precision: number ): string {
	if ( precision <= 8 ) {
		let year = time.getFullYear();
		year -= year % 10 ** ( 9 - precision );
		time.setFullYear( year );
	}

	time.setUTCHours( 0 );
	time.setUTCMinutes( 0 );
	time.setUTCSeconds( 0 );

	let result = time.toISOString().replace( /\.000Z/, 'Z' );

	if ( precision <= 10 ) {
		result = result.replace( /-\d\dT/, '-00T' );
	}
	if ( precision <= 9 ) {
		result = result.replace( /-\d\d-/, '-00-' );
	}

	return result;
}

export function createTimeValueFromDate(
	time: Date,
	isBce?: boolean,
	precision?: number,
	forceJulian?: boolean
): TimeValue {
	const result: TimeValue = {
		time: ( isBce ? '-' : '+' ) + createTimeString( time, precision || 11 ),
		precision: precision || 11,
		timezone: 0,
		before: 0,
		after: 0,
		calendarmodel: grigorianCalendar
	};

	if ( forceJulian || isBce || time < new Date( Date.UTC( 1582, 9, 15 ) ) ) {
		result.calendarmodel = julianCalendar;
	}

	return result;
}

/**
 * Format dates as datavalue for Wikidata.
 * Returns null for novalue and undefined for somevalue or if nothing found.
 */
export function createTimeValue( timestamp: string, forceJulian?: boolean ): TimeValue | null | undefined {
	if ( !timestamp ) {
		return;
	}

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
	if ( guess.type === 'novalue' ) {
		return null;
	} else if ( guess.type !== 'value' ) {
		return;
	}

	return createTimeValueFromDate( guess.isoDate, isBce, guess.precision, forceJulian );
}

function createTimeSnak( value: TimeValue, propertyId: PropertyId ): Snak {
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

export function prepareTime( context: Context ): Statement[] {
	const statements: Statement[] = [];

	const timeText: string = context.text.toLowerCase().trim().replace( getConfig( 're-year-postfix' ), '' );
	const isJulian: boolean = context.text.includes( getConfig( 'mark-julian' ) );

	if ( timeText.match( /.{4,}[-−–—].{4,}/ ) && startEndPropertyMapping[ context.propertyId ] ) {
		const parts: string[] = timeText.split( /[-−–—]/ );
		if ( parts.length === 2 ) {
			const startDateValue: Value | null | undefined = createTimeValue( parts[ 0 ], isJulian );
			const endDateValue: Value | null | undefined = createTimeValue( parts[ 1 ], isJulian );
			if ( startDateValue !== undefined && endDateValue !== undefined ) {
				const references: Reference[] = getReferences( context.$wrapper );

				let startDateSnak: Snak;
				if ( startDateValue ) {
					startDateSnak = createTimeSnak( startDateValue, context.propertyId );
				} else {
					startDateSnak = createNovalueSnak( context.propertyId );
				}
				const startDateStatement: Statement = convertSnakToStatement( startDateSnak, references );
				statements.push( startDateStatement );

				let endDateSnak: Snak;
				if ( endDateValue ) {
					endDateSnak = createTimeSnak( endDateValue, startEndPropertyMapping[ context.propertyId ] );
				} else {
					endDateSnak = createNovalueSnak( startEndPropertyMapping[ context.propertyId ] );
				}
				const endDateStatement: Statement = convertSnakToStatement( endDateSnak, references );
				statements.push( endDateStatement );

				return statements;
			}
		}
	}

	const value: TimeValue | void = createTimeValue( timeText, isJulian );
	if ( value ) {
		const snak: Snak = createTimeSnak( value, context.propertyId );
		const references: Reference[] = getReferences( context.$wrapper );
		const statement: Statement = convertSnakToStatement( snak, references );
		statements.push( statement );
	}

	return statements;
}
