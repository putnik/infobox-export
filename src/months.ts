import { getMessages } from './api';
import { contentLanguage } from './languages';
import { KeyValue } from './types/main';

let months: string[] = [
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december'
];
let monthsGen: string[] = months;

export function getMonths(): string[] {
	return months;
}

export function getMonthsGen(): string[] {
	return monthsGen;
}

/**
 * Load local month names from messages API
 */
export async function loadMonths(): Promise<void> {
	const messageKeys: string[] = [];
	for ( const month of months ) {
		messageKeys.push( month === 'may' ? 'may long' : month );
		messageKeys.push( month + '-gen' );
	}
	const messages: KeyValue = await getMessages( messageKeys, contentLanguage );
	const monthLocal: string[] = [];
	const monthLocalGen: string[] = [];
	for ( const month of months ) {
		monthLocal.push( messages[ month === 'may' ? 'may long' : month ] );
		monthLocalGen.push( messages[ month + '-gen' ] );
	}
	months = monthLocal;
	monthsGen = monthLocalGen;
}
