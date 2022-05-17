import { Context, KeyValue, Property } from '../types/main';
import { getConfig, getOrLoadUnit, getOrLoadProperty, preloadUnits } from '../config';
import { QuantityValue, TimeValue } from '../types/wikidata/values';
import { randomEntityGuid, generateItemSnak } from '../wikidata';
import { addQualifiers } from '../parser';
import { DataValue } from '../types/wikidata/datavalues';
import { Reference, Snak, Statement } from '../types/wikidata/main';
import { ItemId, PropertyId, Unit } from '../types/wikidata/types';
import { createTimeValue } from './time';
import { getReferences } from './utils';

const NoUnit = '1';

function numberToString( value: number, integral: number, fractional: number, magnitude: number ): string {
	const integralMultiplier: number = parseFloat( '1e-' + integral.toString() );
	const fractionalMultiplier: number = parseFloat( '1e' + fractional.toString() );
	const magnitudeMultiplier: number = parseFloat( '1e' + magnitude.toString() );

	if ( magnitude >= 0 ) {
		if ( magnitude <= fractional ) {
			return ( magnitudeMultiplier * value ).toFixed( fractional - magnitude );
		}
		return ( fractionalMultiplier * value ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
	}
	if ( magnitude >= -integral ) {
		return ( magnitudeMultiplier * value ).toFixed( fractional - magnitude );
	}
	return ( integralMultiplier * value ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
}

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseRawQuantity( config: any, text: string, forceInteger?: boolean ): QuantityValue | null {
	const value: QuantityValue = {
		amount: '0',
		unit: NoUnit
	};
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();

	let magnitude: number = 0;
	if ( text.match( config[ 're-10_3' ] ) ) {
		magnitude += 3;
	} else if ( text.match( config[ 're-10_6' ] ) ) {
		magnitude += 6;
	} else if ( text.match( config[ 're-10_9' ] ) ) {
		magnitude += 9;
	} else if ( text.match( config[ 're-10_12' ] ) ) {
		magnitude += 12;
	} else {
		const re10n: RegExp = / *[*·⋅×] *10(-?\d+)/;
		const match: RegExpMatchArray | null = text.match( re10n );
		if ( match ) {
			text = text.replace( re10n, '' );
			magnitude += parseInt( match[ 1 ] );
		}
	}
	const decimals: string[] = text.split( '±' );
	if ( magnitude === 0 && forceInteger ) {
		decimals[ 0 ] = decimals[ 0 ].replace( /\./g, '' ).trim();
	}

	const interval: string[] = decimals[ 0 ].split( '-' );
	if ( decimals.length === 1 &&
		interval.length === 2 &&
		interval[ 0 ].replace( /[^\d]/g, '' ).length !== 0 &&
		interval[ 1 ].replace( /[^\d]/g, '' ).length !== 0
	) {
		value.lowerBound = interval[ 0 ].replace( /[^0-9.+-]/g, '' );
		value.upperBound = interval[ 1 ].replace( /[^0-9.+-]/g, '' );
		const parts: RegExpMatchArray | null = value.lowerBound.match( /(\d+)\.(\d+)/ );
		let fractional: number = parts ? parts[ 2 ].length : 0;
		const upperBound: number = parseFloat( value.upperBound );
		const lowerBound: number = parseFloat( value.lowerBound );
		if ( upperBound < lowerBound ) {
			return null;
		}
		const amount: number = ( upperBound + lowerBound ) / 2;
		const integral: number = parts ? parts[ 1 ].length : amount.toString().length;
		value.lowerBound = numberToString( lowerBound, integral, fractional, magnitude );
		value.upperBound = numberToString( upperBound, integral, fractional, magnitude );
		if ( upperBound % 2 !== lowerBound % 2 ) {
			fractional += 1;
		}
		value.amount = numberToString( amount, integral, fractional, magnitude );
		return value;
	}

	const amount: number = parseFloat( decimals[ 0 ].replace( /[^0-9.+-]/g, '' ) );
	if ( isNaN( amount ) ) {
		return null;
	}

	let bound: number;
	let parts: RegExpMatchArray | null = amount.toString().match( /(\d+)\.(\d+)/ );
	let integral: number = parts ? parts[ 1 ].length : amount.toString().length;
	let fractional: number = parts ? parts[ 2 ].length : 0;
	value.amount = numberToString( amount, integral, fractional, magnitude );

	if ( decimals.length > 1 ) {
		bound = parseFloat( decimals[ 1 ].replace( /[^0-9.+-]/g, '' ) );
	}

	if ( !isNaN( bound ) ) {
		if ( decimals.length > 1 && decimals[ 1 ].indexOf( '%' ) > 0 ) {
			bound = amount * bound / 100;
		} else {
			parts = bound.toString().match( /(\d+)\.(\d+)/ );
			integral = parts ? parts[ 1 ].length : amount.toString().length;
			fractional = parts ? parts[ 2 ].length : 0;
		}
		value.lowerBound = numberToString( amount - bound, integral, fractional, magnitude );
		value.upperBound = numberToString( amount + bound, integral, fractional, magnitude );
	}
	return value;
}

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseQuantity( text: string, propertyId: PropertyId, forceInteger?: boolean ): Statement | null {
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();
	const config: KeyValue = {
		're-10_3': getConfig( 're-10_3' ),
		're-10_6': getConfig( 're-10_6' ),
		're-10_9': getConfig( 're-10_9' ),
		're-10_12': getConfig( 're-10_12' )
	};

	const value: QuantityValue | null = parseRawQuantity( config, text, forceInteger );
	if ( value === null ) {
		return null;
	}
	const dataValue: DataValue = {
		type: 'quantity',
		value: value
	};
	const snak: Snak = {
		property: propertyId,
		snaktype: 'value',
		datatype: 'quantity',
		datavalue: dataValue
	};
	const statement: Statement = {
		mainsnak: snak,
		type: 'statement',
		id: randomEntityGuid(),
		rank: 'normal'
	};

	// Sourcing circumstances (P1480) = circa (Q5727902)
	const circaMatch = text.match( getConfig( 're-circa' ) );
	if ( circaMatch ) {
		statement.qualifiers = {
			P1480: [
				generateItemSnak( 'P1480', 'Q5727902' )
			]
		};
	}

	return statement;
}

/**
 * Recognition of units of measurement in the infobox parameter and its label
 */
async function recognizeUnits( text: string, units: KeyValue, label?: string ): Promise<Unit[]> {
	if ( Array.isArray( units ) && units.length === 0 ) {
		return [];
	}
	await preloadUnits( units );
	const result: Unit[] = [];
	for ( const idx in units ) {
		if ( !units.hasOwnProperty( idx ) ) {
			continue;
		}
		const itemId: ItemId = parseInt( idx, 10 ) >= 0 ? units[ idx ] : idx;
		const search: string[] = await getOrLoadUnit( itemId );
		if ( !search?.length ) {
			continue;
		}
		for ( let j = 0; j < search.length; j++ ) {
			let expr = search[ j ];
			if ( search[ j ].charAt( 0 ) !== '^' ) {
				if ( search[ j ].length < 5 ) {
					expr = `^${expr}|[\\d\\s\\.]${expr}\\.?$`;
				} else {
					expr = `[\\d\\s\\.]${expr}`;
				}
			}
			if ( text.match( new RegExp( expr ) ) ) {
				result.push( `http://www.wikidata.org/entity/${itemId}` );
				break;
			}

			if ( search[ j ].charAt( 0 ) === '^' || label === undefined ) {
				continue;
			}
			const labelRegExp = new RegExp( `\\s${search[ j ]}:?$` );
			if ( label.match( labelRegExp ) ) {
				result.push( `http://www.wikidata.org/entity/${itemId}` );
				break;
			}
		}
	}
	return result;
}

async function removeUnitString( text: string, unit: Unit ): Promise<string> {
	if ( unit === NoUnit ) {
		return text;
	}
	const itemId: ItemId = unit.replace( /^.+\/(Q\d+)$/, '$1' ) as ItemId;
	const searches: string[] = await getOrLoadUnit( itemId );
	searches.forEach( function ( search: string ) {
		text = text.replace( search, '' );
	} );
	return text;
}

export async function prepareQuantity( context: Context ): Promise<Statement[]> {
	const statements: Statement[] = [];
	const thText: string = context.$wrapper.closest( 'tr' ).find( 'th, .infobox-export-label' ).first().text().trim();
	let text: string = context.text
		.replace( /[\u00a0\u25bc\u25b2]/g, ' ' )
		.replace( /\s*\(([^)]*\))/g, '' )
		.trim();

	// Hack for time in formats "hh:mm:ss" and "00m 00s""
	const match: string[] = text.replace( getConfig( 're-min-sec' ), '$1:$2' )
		.match( /^(?:(\d+):)?(\d+):(\d+)$/ );
	if ( match ) {
		let amount = 0;
		for ( let i = 1; i < match.length; i++ ) {
			if ( match[ i ] !== undefined ) {
				amount = amount * 60 + parseInt( match[ i ], 10 );
			}
		}

		text = amount + getConfig( 'unit-sec' );
	}

	const property: Property | undefined = await getOrLoadProperty( context.propertyId );
	const foundUnits: Unit[] = await recognizeUnits( text, property?.units || [], thText );
	const isUnitOptional: boolean = property?.constraints?.unitOptional || false;
	if ( isUnitOptional ) {
		foundUnits.push( NoUnit );
	}

	const forceInteger: boolean = property?.constraints?.integer || false;
	for ( let u = 0; u < foundUnits.length; u++ ) {
		const textWithoutUnit: string = await removeUnitString( text, foundUnits[ u ] );
		let statement: Statement | void = parseQuantity( textWithoutUnit, context.propertyId, forceInteger );
		if ( !statement ) {
			continue;
		}
		( statement.mainsnak.datavalue.value as QuantityValue ).unit = foundUnits[ u ];

		const references: Reference[] = getReferences( context.$wrapper );
		if ( references.length ) {
			statement.references = references;
		}

		statement = await addQualifiers( context.$field, statement );

		if ( ( property?.constraints?.qualifier || [] ).includes( 'P585' ) ) {
			let yearMatch: string[] = context.text.match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
			if ( !yearMatch ) {
				yearMatch = thText.match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
			}
			if ( yearMatch ) {
				const extractedDate: TimeValue | void = createTimeValue( yearMatch[ 1 ].replace( /(\d)\s(\d)/, '$1$2' ) );
				if ( extractedDate ) {
					statement.qualifiers = {
						P585: [ {
							snaktype: 'value',
							property: 'P585',
							datavalue: {
								type: 'time',
								value: extractedDate
							},
							datatype: 'time'
						} ]
					};
				}
			}
		}

		const qualifierMatch: RegExpMatchArray | null = context.text.match( /\(([^)]*)/ );
		if ( qualifierMatch ) {
			const qualifierTempStatement: Statement | null = parseQuantity( qualifierMatch[ 1 ], 'P0' );
			if ( qualifierTempStatement ) {
				const qualifierQuantitySnak: Snak = qualifierTempStatement.mainsnak;
				const qualifierQuantity: QuantityValue = qualifierQuantitySnak.datavalue.value as QuantityValue;
				const supportedProperties: PropertyId[] = [ 'P2076', 'P2077' ];
				for ( let j = 0; j < supportedProperties.length; j++ ) {
					const supportedProperty: Property | undefined = await getOrLoadProperty( supportedProperties[ j ] );
					const units: ItemId[] = supportedProperty?.units || [];
					if ( units.length === 1 ) {
						qualifierQuantity.unit = `http://www.wikidata.org/entity/${units[ 0 ]}`;
						if ( !statement.qualifiers ) {
							statement.qualifiers = {};
						}
						statement.qualifiers[ supportedProperties[ j ] ] = [ {
							snaktype: 'value',
							property: supportedProperties[ j ],
							datavalue: {
								type: 'quantity',
								value: qualifierQuantity
							},
							datatype: 'quantity'
						} ];
					}
				}
			}
		}
		statements.push( statement );
	}

	return statements;
}

export function canExportQuantity( statements: Statement[], $field: JQuery ): boolean {
	for ( let i = 0; i < Object.keys( statements ).length; i++ ) {
		const parsedTime: TimeValue | void = createTimeValue( ( $field.text().match( /\(([^)]*\d\d\d\d)[,)\s]/ ) || [] )[ 1 ] );
		if ( parsedTime && statements[ i ].qualifiers?.P585 ) {
			const pointInTimeValue: TimeValue = statements[ i ].qualifiers.P585[ 0 ].datavalue.value as TimeValue;
			if ( parsedTime.precision < pointInTimeValue.precision ) {
				( statements[ i ].qualifiers.P585[ 0 ].datavalue.value as TimeValue ).precision = parsedTime.precision;
			} else if ( parsedTime.precision > pointInTimeValue.precision ) { // FIXME: Specify the date in Wikidata later
				parsedTime.precision = pointInTimeValue.precision;
			}

			// if ( await formatSnak( 'P585', statements[ i ].qualifiers.P585[ 0 ].datavalue )[ 0 ].innerText !== p585 ) {
			// statements[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = claimPrecision;
			// continue;
			// }
		}
		return false;
	}
	return true;
}
