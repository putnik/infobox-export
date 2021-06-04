const config: {[key: string]: string} = {
	'wgContentLanguage': 'de'
};

const userOptions: {[key: string]: string} = {
	'language': 'ru'
};

export default {
	config: {
		get: function ( key: string ): string {
			return config[ key ];
		}
	},
	user: {
		options: {
			get: function ( key: string ): string {
				return userOptions[ key ];
			}
		}
	}
};
