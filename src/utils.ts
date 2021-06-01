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
