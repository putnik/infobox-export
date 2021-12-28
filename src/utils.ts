/**
 * Returns an array of elements with duplicate values deleted
 */
import { KeyValue } from './types/main';

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

export function clone( value: any ): any {
	return JSON.parse( JSON.stringify( value ) );
}

export function get( object: object, path: string ): any {
	return path
		.split( '.' )
		.reduce(
			( obj: object | any, key: string ) => obj?.[ key ],
			object
		);
}

export function set( object: object, path: string, value: any ): void {
	const keys: string[] = path.split( '.' );
	return keys.reduce(
		function ( obj: object | any, key: string, index: number ) {
			if ( index < keys.length - 1 ) {
				if ( typeof obj[ key ] !== 'object' || obj[ key ] === null ) {
					obj[ key ] = {};
				}
			} else {
				obj[ key ] = value;
			}
			return obj[ key ];
		},
		object
	);
}

export function getLabelValue( labels: KeyValue, languages: string[], defaultValue?: string ): string {
	languages.push( 'en' );
	for ( const i in languages ) {
		const language: string = languages[ i ];
		if ( labels[ language ] ) {
			return labels[ language ].value;
		}
	}
	if ( Object.values( labels ).length ) {
		const label: KeyValue = Object.values( labels ).shift();
		return label.value;
	}
	if ( defaultValue ) {
		return defaultValue;
	}
	return '';
}

export async function sleep( milliseconds: number ): Promise<void> {
	// eslint-disable-next-line
	return new Promise<void>( resolve => setTimeout( resolve, milliseconds ) );
}
