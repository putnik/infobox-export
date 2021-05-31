/**
 * Parsing the number and (optionally) the accuracy
 */
export function parseRawQuantity( config, text, forceInteger ) {
	const value = {};
	text = text.replace( /,/g, '.' ).replace( /[−–—]/g, '-' ).trim();

	let magnitude = 0;
	if ( text.match( config['re-10_3'] ) ) {
		magnitude += 3;
	} else if ( text.match( config['re-10_6'] ) ) {
		magnitude += 6;
	} else if ( text.match( config['re-10_9'] ) ) {
		magnitude += 9;
	} else if ( text.match( config['re-10_12'] ) ) {
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
		parts = value.lowerBound.match( /(\d+)\.(\d+)/ );
		fractional = parts ? parts[ 2 ].length : 0;
		const upperBound = parseFloat( value.upperBound );
		const lowerBound = parseFloat( value.lowerBound );
		const amount = ( upperBound + lowerBound ) / 2;
		const bound = ( upperBound - lowerBound ) / 2;
		if (upperBound % 2 !== lowerBound % 2) {
			fractional += 1;
		}
		value.amount = amount.toFixed( fractional  );
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
	if ( magnitude >= 0 ) {
		if ( magnitude <= fractional ) {
			value.amount = ( ( '1e' + magnitude ) * amount ).toFixed( fractional - magnitude );
		} else {
			value.amount = ( ( '1e' + fractional ) * amount ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
		}
	} else {
		if ( magnitude >= -integral ) {
			value.amount = ( ( '1e' + magnitude ) * amount ).toFixed( fractional - magnitude );
		} else {
			value.amount = ( ( '1e-' + integral ) * amount ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
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
		if ( magnitude >= 0 ) {
			if ( magnitude <= fractional ) {
				value.lowerBound = ( ( '1e' + magnitude ) * ( amount - bound ) ).toFixed( fractional - magnitude );
				value.upperBound = ( ( '1e' + magnitude ) * ( amount + bound ) ).toFixed( fractional - magnitude );
				value.bound = ( ( '1e' + magnitude ) * bound ).toFixed( fractional - magnitude ); // need to show it to user
			} else {
				value.lowerBound = ( ( '1e' + fractional ) * ( amount - bound ) ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
				value.upperBound = ( ( '1e' + fractional ) * ( amount + bound ) ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
				value.bound = ( ( '1e' + fractional ) * bound ).toFixed( 0 ).replace( /$/, new Array( magnitude - fractional + 1 ).join( '0' ) );
			}
		} else {
			if ( magnitude >= -integral ) {
				value.lowerBound = ( ( '1e' + magnitude ) * ( amount - bound ) ).toFixed( fractional - magnitude );
				value.upperBound = ( ( '1e' + magnitude ) * ( amount + bound ) ).toFixed( fractional - magnitude );
				value.bound = ( ( '1e' + magnitude ) * bound ).toFixed( fractional - magnitude );
			} else {
				value.lowerBound = ( ( '1e-' + integral ) * ( amount - bound ) ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
				value.upperBound = ( ( '1e-' + integral ) * ( amount + bound ) ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
				value.bound = ( ( '1e-' + integral ) * bound ).toFixed( integral + fractional ).replace( /0\./, '0.' + new Array( -magnitude - integral + 1 ).join( '0' ) );
			}
		}
	}
	return value;
}
