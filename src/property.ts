import type { SparqlBindings, SparqlResponse } from './types/api';
import type { Property, Type } from './types/main';
import type { ClaimsObject } from './types/wikidata/main';
import type { ItemId, PropertyId } from './types/wikidata/types';
import { sparqlRequest } from './api';
import { getProperties, getType, loadProperties, setTypes } from './config';
import { getItemPropertyValues } from './wikidata';

let availablePropertiesSet: Set<PropertyId> | undefined;

const propertyReplacements: { [key: PropertyId]: PropertyId } = {
	P276: 'P131',
	P6375: 'P669'
};

export async function preloadAvailableProperties( typeIds: ItemId[] ): Promise<void> {
	availablePropertiesSet = new Set();

	const typeIdsToQuery: ItemId[] = [];
	const typesObject: { [ key: ItemId ]: Set<PropertyId> } = {};
	for ( const typeId of typeIds ) {
		const type: Type | undefined = await getType( typeId );
		if ( type === undefined ) {
			typeIdsToQuery.push( typeId );
			typesObject[ typeId ] = new Set();
			continue;
		}
		for ( const propertyId of type.properties ) {
			availablePropertiesSet.add( propertyId );
		}
	}

	const supportedTypes: string[] = [
		'CommonsMedia',
		'ExternalId',
		'GlobeCoordinate',
		'Monolingualtext',
		'Quantity',
		'String',
		'Time',
		'WikibaseItem',
		'Url'
	];

	for ( const typeId of typeIdsToQuery ) {
		const sparql: string = `SELECT DISTINCT (SUBSTR(STR(?property), 32) as ?pid) {
			?property rdf:type wikibase:Property.
			VALUES ?supportedTypes {wikibase:${supportedTypes.join( ' wikibase:' )}}.
			?property  wikibase:propertyType ?supportedTypes.
			?property p:P2302 ?scopeConstraint.
			?scopeConstraint ps:P2302 wd:Q53869507;
				pq:P5314 wd:Q54828448.
			OPTIONAL {
				?property p:P2302 ?classConstraint .
				?classConstraint ps:P2302 wd:Q21503250;
					pq:P2308 ?class.
				FILTER ( ?class != wd:Q29934200 )
			}
			FILTER( IF ( BOUND(?class),
				EXISTS { wd:${typeId} wdt:P279* ?class. },
				NOT EXISTS { ?property wikibase:propertyType wikibase:ExternalId }
			) )
		}`;
		const data: SparqlResponse = await sparqlRequest( sparql );

		if ( !data?.results?.bindings?.length ) {
			return;
		}

		for ( let i = 0; i < data.results.bindings.length; i++ ) {
			const bindings: SparqlBindings = data.results.bindings[ i ];
			const propertyId: PropertyId = bindings.pid.value as PropertyId;
			availablePropertiesSet.add( propertyId );
			typesObject[ typeId ].add( propertyId );
		}
	}

	const types: Type[] = [];
	for ( const typeId of Object.keys( typesObject ) ) {
		types.push( {
			id: typeId as ItemId,
			properties: Array.from( typesObject[ typeId as ItemId ].values() ) as PropertyId[]
		} );
	}
	await setTypes( types );

	await loadProperties( availablePropertiesSet );
}

export async function guessPropertyIdByLabel( $label: JQuery, itemId: ItemId, claims: ClaimsObject ): Promise<PropertyId[]> {
	const typeIds: ItemId[] = getItemPropertyValues( claims, 'P31' );

	if ( typeof availablePropertiesSet === 'undefined' ) {
		await preloadAvailableProperties( typeIds );
	}
	const propertyIds: PropertyId[] = [];
	const label: string = $label.text().replace( /:$/, '' ).trim().toLowerCase();
	const baseLabel: string = label.replace( /\(.+?\)/, '' ).trim();

	const availableProperties: Property[] = await getProperties( Array.from( availablePropertiesSet ) );
	for ( const property of availableProperties ) {
		if ( !property.aliases || !( property.aliases.includes( label ) || property.aliases.includes( baseLabel ) ) ) {
			continue;
		}

		// Property replacements
		if ( typeIds.length ) {
			const replacementIds: ( PropertyId | null )[] = typeIds.map(
				( typeId: ItemId ) => property.constraints.noneOfTypes[ typeId ]
			).filter( ( replacementIds: PropertyId ) => replacementIds !== undefined );
			if ( replacementIds.length ) {
				const replacementId: PropertyId = replacementIds.pop();
				if ( replacementId ) {
					propertyIds.push( replacementId );
				}
				continue;
			}
		}
		if ( propertyReplacements[ property.id ] ) {
			propertyIds.push( propertyReplacements[ property.id ] );
			continue;
		}

		propertyIds.push( property.id );
	}
	return propertyIds;
}
