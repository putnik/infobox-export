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
