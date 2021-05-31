import {floor, random} from 'math';

const $ = require('jquery');

/**
 * Returns an array of elements with duplicate values deleted
 */
export function unique( array ) {
	return $.grep( array, function ( el, index ) {
		return index === $.inArray( el, array );
	} );
}

export function getRandomHex( min, max ) {
	return ( floor( random() * ( max - min + 1 ) ) + min ).toString( 16 );
}

export function camelToSnakeCase( value ) {
	return value.replace( /(.)([A-Z0-9]+)/g, function ( g ) {
		if ( g[ 0 ] === '.' || g[ 0 ] === '_' ) {
			return g[ 0 ].concat( g.substring( 1 ) );
		}
		return g[ 0 ].concat( '-' ).concat( g.substring( 1 ).toLowerCase() );
	} );
}
