import { getMessages } from "./api";
import { contentLanguage } from "./languages";

const mw = require('mw');

let months = [
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december'
];
let monthsGen = months;

export function getMonths() {
	return months;
}

export function getMonthsGen() {
	return monthsGen;
}

/**
 * Load local month names from messages API
 */
export function loadMonths() {
	const messageKeys = [];
	for ( const i in months ) {
		messageKeys.push( months[ i ] );
		messageKeys.push( months[ i ] + '-gen' );
	}
	getMessages( messageKeys, contentLanguage )
		.then( function ( messages ) {
			const monthLocal = [];
			const monthLocalGen = [];
			for ( const pos in months ) {
				const key = months[ pos ];
				monthLocal.push( messages[ key ] );
				monthLocalGen.push( messages[ key + '-gen' ] );
			}
			months = monthLocal;
			monthsGen = monthLocalGen;
		} );
}
