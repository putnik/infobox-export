import { WikidataClaim, WikidataSnak } from '../types/wikidata';
import { KeyValue } from '../types/main';
import { getConfig } from '../config';
import { QuantityValue, TimeValue } from '../types/wikidata/values';
import { getI18n } from '../i18n';
import { createTimeSnak } from '../wikidata';
import { addQualifiers } from '../parser';

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseRawQuantity( config: any, text: string, forceInteger?: boolean ): QuantityValue {
	const value: QuantityValue = {
		amount: '0',
		unit: '1'
	};
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();

	let magnitude = 0;
	if ( text.match( config[ 're-10_3' ] ) ) {
		magnitude += 3;
	} else if ( text.match( config[ 're-10_6' ] ) ) {
		magnitude += 6;
	} else if ( text.match( config[ 're-10_9' ] ) ) {
		magnitude += 9;
	} else if ( text.match( config[ 're-10_12' ] ) ) {
		magnitude += 12;
	} else {
		const match = text.match( /[*|·]10(-?\d+)/ );
		if ( match ) {
			text = text.replace( /[*|·]10(-?\d+)/, '' );
			magnitude += parseInt( match[ 1 ] );
		}
	}
	const decimals = text.split( '±' );
	if ( magnitude === 0 && forceInteger ) {
		decimals[ 0 ] = decimals[ 0 ].replace( /\./g, '' ).trim();
	}

	let amount;
	let bound;
	const interval = decimals[ 0 ].split( '-' );
	if ( magnitude === 0 &&
		decimals.length === 1 &&
		interval.length === 2 &&
		interval[ 0 ].length !== 0 &&
		interval[ 1 ].length !== 0
	) {
		value.lowerBound = interval[ 0 ].replace( /[^0-9.+-]/g, '' );
		value.upperBound = interval[ 1 ].replace( /[^0-9.+-]/g, '' );
		const parts = value.lowerBound.match( /(\d+)\.(\d+)/ );
		let fractional: number = parts ? parts[ 2 ].length : 0;
		const upperBound: number = parseFloat( value.upperBound );
		const lowerBound: number = parseFloat( value.lowerBound );
		const amount: number = ( upperBound + lowerBound ) / 2;
		if ( upperBound % 2 !== lowerBound % 2 ) {
			fractional += 1;
		}
		value.amount = amount.toFixed( fractional );
		return value;
	} else {
		amount = parseFloat( decimals[ 0 ].replace( /[^0-9.+-]/g, '' ) );
	}

	if ( isNaN( amount ) ) {
		return;
	}

	let parts = amount.toString().match( /(\d+)\.(\d+)/ );
	let integral = parts ? parts[ 1 ].length : amount.toString().length;
	let fractional = parts ? parts[ 2 ].length : 0;
	let fractionalMultiplier: number = parseFloat( '1e' + fractional.toString() );
	let magnitudeMultiplier: number = parseFloat( '1e' + magnitude.toString() );
	let integralMultiplier: number = parseFloat( '1e-' + integral.toString() );
	if ( magnitude >= 0 ) {
		if ( magnitude <= fractional ) {
			value.amount = ( magnitudeMultiplier * amount ).toFixed( fractional - magnitude );
		} else {
			value.amount = ( fractionalMultiplier * amount ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
		}
	} else {
		if ( magnitude >= -integral ) {
			value.amount = ( magnitudeMultiplier * amount ).toFixed( fractional - magnitude );
		} else {
			value.amount = ( integralMultiplier * amount ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
		}
	}

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
		fractionalMultiplier = parseFloat( '1e' + fractional.toString() );
		magnitudeMultiplier = parseFloat( '1e' + magnitude.toString() );
		integralMultiplier = parseFloat( '1e-' + integral.toString() );

		const lowerBound = amount - bound;
		const upperBound = amount + bound;
		if ( magnitude >= 0 ) {
			if ( magnitude <= fractional ) {
				value.lowerBound = ( magnitudeMultiplier * lowerBound ).toFixed( fractional - magnitude );
				value.upperBound = ( magnitudeMultiplier * upperBound ).toFixed( fractional - magnitude );
			} else {
				value.lowerBound = ( fractionalMultiplier * lowerBound ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
				value.upperBound = ( fractionalMultiplier * upperBound ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
			}
		} else {
			if ( magnitude >= -integral ) {
				value.lowerBound = ( magnitudeMultiplier * lowerBound ).toFixed( fractional - magnitude );
				value.upperBound = ( magnitudeMultiplier * upperBound ).toFixed( fractional - magnitude );
			} else {
				value.lowerBound = ( integralMultiplier * lowerBound ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
				value.upperBound = ( integralMultiplier * upperBound ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
			}
		}
	}
	return value;
}

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseQuantity( text: string, forceInteger?: boolean ): WikidataSnak {
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();
	const config: KeyValue = {
		're-10_3': getConfig( 're-10_3' ),
		're-10_6': getConfig( 're-10_6' ),
		're-10_9': getConfig( 're-10_9' ),
		're-10_12': getConfig( 're-10_12' )
	};

	const value: QuantityValue | undefined = parseRawQuantity( config, text, forceInteger );
	if ( value === undefined ) {
		return;
	}
	const snak: WikidataSnak = {
		type: 'quantity',
		value: value
	};

	// Sourcing circumstances (P1480) = circa (Q5727902)
	const circaMatch = text.match( getConfig( 're-circa' ) );
	if ( circaMatch ) {
		snak.qualifiers = {
			P1480: [ {
				property: 'P1480',
				snaktype: 'value',
				datavalue: {
					type: 'wikibase-entityid',
					value: { id: 'Q5727902' }
				}
			} ]
		};
		text = text.replace( circaMatch[ 0 ], '' ); // FIXME: modify text
	}

	return snak;
}

/**
 * Recognition of units of measurement in the infobox parameter and its label
 */
function recognizeUnits( text: string, units: KeyValue, label?: string ): string[] {
	if ( Array.isArray( units ) && units.length === 0 ) {
		return [ '1' ];
	}
	const result: string[] = [];
	for ( const idx in units ) {
		if ( !units.hasOwnProperty( idx ) ) {
			continue;
		}
		const item: string = parseInt( idx, 10 ) >= 0 ? units[ idx ] : idx;
		const search: string = getConfig( 'units' )[ item ].search;
		for ( let j = 0; j < search.length; j++ ) {
			let expr = search[ j ];
			if ( search[ j ].charAt( 0 ) !== '^' ) {
				expr = '[\\d\\s\\.]' + expr;
				if ( search[ j ].length < 5 ) {
					expr = expr + '\\.?$';
				}
			}
			if ( text.match( new RegExp( expr ) ) ) {
				result.push( item );
				break;
			} else if ( search[ j ].charAt( 0 ) !== '^' && label && label.match( new RegExp( '\\s' + search[ j ] + ':?$' ) ) ) {
				result.push( item );
				break;
			}
		}
	}
	return result;
}

export async function prepareQuantity( $content: JQuery, propertyId: string ): Promise<WikidataSnak[]> {
	let snaks: WikidataSnak[] = [];
	let text: string = $content.text()
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

		text = amount + getI18n( 'unit-sec' );
	}

	const snak: WikidataSnak = parseQuantity( text, getConfig( 'properties.' + propertyId + '.constraints.integer' ) );
	if ( !snak || !snak.value ) {
		return;
	}

	snaks = await addQualifiers( $content, snak );

	if ( getConfig( 'properties.' + propertyId + '.constraints.qualifier' ).indexOf( 'P585' ) !== -1 ) {
		let yearMatch: string[] = $content.text().match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
		if ( !yearMatch ) {
			yearMatch = $content.closest( 'tr' ).find( 'th' ).first().text().match( /\(([^)]*[12]\s?\d\d\d)[,)\s]/ );
		}
		if ( yearMatch ) {
			const extractedDate: TimeValue | string = createTimeSnak( yearMatch[ 1 ].replace( /(\d)\s(\d)/, '$1$2' ) );
			if ( extractedDate ) {
				snak.qualifiers = {
					P585: [ {
						snaktype: 'value',
						property: 'P585',
						datavalue: {
							type: 'time',
							value: extractedDate
						}
					} ]
				};
			}
		}
	}

	const qualifierMatch: RegExpMatchArray = $content.text().match( /\(([^)]*)/ );
	if ( qualifierMatch ) {
		const qualifierQuantitySnak: WikidataSnak = parseQuantity( qualifierMatch[ 1 ] );
		if ( qualifierQuantitySnak ) {
			// @ts-ignore
			const qualifierQuantity: QuantityValue = qualifierQuantitySnak.value;
			const supportedProperties: string[] = [ 'P2076', 'P2077' ];
			for ( let j = 0; j < supportedProperties.length; j++ ) {
				const units: string[] = recognizeUnits( qualifierMatch[ 1 ], getConfig( 'properties.' + supportedProperties[ j ] + '.units' ) );
				if ( units.length === 1 ) {
					qualifierQuantity.unit = 'http://www.wikidata.org/entity/' + units[ 0 ];
					if ( !snak.qualifiers ) {
						snak.qualifiers = {};
					}
					snak.qualifiers[ supportedProperties[ j ] ] = [ {
						snaktype: 'value',
						property: supportedProperties[ j ],
						datavalue: {
							type: 'quantity',
							value: qualifierQuantity
						}
					} ];
				}
			}
		}
	}

	const founded: string[] = recognizeUnits( text, getConfig( 'properties' )[ propertyId ].units, $content.closest( 'tr' ).find( 'th' ).first().text() );
	for ( let u = 0; u < founded.length; u++ ) {
		// @ts-ignore
		snak.value.unit = '1';
		if ( founded[ u ] !== '1' ) {
			// @ts-ignore
			snak.value.unit = 'http://www.wikidata.org/entity/' + founded[ u ];
			// const item = getConfig( 'units.' + founded[ u ] );
		}
		snak.type = 'quantity';
		snaks.push( snak );
	}

	return snaks;
}

export function canExportQuantity( claims: WikidataClaim[] ): boolean {
	for ( let i = 0; i < Object.keys( claims ).length; i++ ) {
		// @ts-ignore
		const parsedTime: TimeValue = createTimeSnak( ( $field.text().match( /\(([^)]*\d\d\d\d)[,)\s]/ ) || [] )[ 1 ] );
		if ( parsedTime && ( claims[ i ].qualifiers || {} ).P585 ) {
			const claimPrecision: number = claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision;
			if ( parsedTime.precision < claimPrecision ) {
				claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = parsedTime.precision;
			} else if ( parsedTime.precision > claimPrecision ) { // FIXME: Specify the date in Wikidata later
				parsedTime.precision = claimPrecision;
			}

			// if ( await formatSnak( 'P585', claims[ i ].qualifiers.P585[ 0 ].datavalue )[ 0 ].innerText !== p585 ) {
			// claims[ i ].qualifiers.P585[ 0 ].datavalue.value.precision = claimPrecision;
			// continue;
			// }
		}
		return false;
	}
	return true;
}
