import { QuantityValue } from './types/wikidata/values';

/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseRawQuantity( config: any, text: string, forceInteger: boolean ): QuantityValue {
	const value: QuantityValue = {
		amount: '0'
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
		const bound: number = ( upperBound - lowerBound ) / 2;
		if ( upperBound % 2 !== lowerBound % 2 ) {
			fractional += 1;
		}
		value.amount = amount.toFixed( fractional );
		value.bound = bound.toFixed( fractional );
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
		if ( magnitude >= 0 ) {
			if ( magnitude <= fractional ) {
				value.lowerBound = ( magnitudeMultiplier * ( amount - bound ) ).toFixed( fractional - magnitude );
				value.upperBound = ( magnitudeMultiplier * ( amount + bound ) ).toFixed( fractional - magnitude );
				value.bound = ( magnitudeMultiplier * bound ).toFixed( fractional - magnitude ); // need to show it to user
			} else {
				value.lowerBound = ( fractionalMultiplier * ( amount - bound ) ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
				value.upperBound = ( fractionalMultiplier * ( amount + bound ) ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
				value.bound = ( fractionalMultiplier * bound ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
			}
		} else {
			if ( magnitude >= -integral ) {
				value.lowerBound = ( magnitudeMultiplier * ( amount - bound ) ).toFixed( fractional - magnitude );
				value.upperBound = ( magnitudeMultiplier * ( amount + bound ) ).toFixed( fractional - magnitude );
				value.bound = ( magnitudeMultiplier * bound ).toFixed( fractional - magnitude );
			} else {
				value.lowerBound = ( integralMultiplier * ( amount - bound ) ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
				value.upperBound = ( integralMultiplier * ( amount + bound ) ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
				value.bound = ( integralMultiplier * bound ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
			}
		}
	}
	return value;
}
