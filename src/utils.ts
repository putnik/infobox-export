/**
 * Returns an array of elements with duplicate values deleted
 */
export function unique( array: any[] ): any[] {
	const $ = require( 'jquery' );
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

export function uppercaseFirst( value: string ): string {
	return value.substr( 0, 1 ).toUpperCase() + value.substr( 1 );
}
