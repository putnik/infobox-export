const path = require( 'path' );
const webpack = require( 'webpack' );

const APP_SOURCE = path.join( __dirname, 'src' );

module.exports = {
	entry: path.join( APP_SOURCE, 'index.ts' ),
	externals: {
		jquery: 'jQuery',
		mw: 'mw',
		oojs: 'OO',
		ooui: [ 'OO', 'ui' ],
		window: 'window'
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/
			},
			{
				test: /\.css$/i,
				type: 'asset/source'
			}
		]
	},
	resolve: {
		extensions: [ '.tsx', '.ts', '.js' ]
	},
	output: {
		filename: 'main.js',
		path: path.resolve( __dirname, 'dist' )
	},
	target: [ 'web', 'es2017' ],
	plugins: [
		new webpack.DefinePlugin( {
			__VERSION__: JSON.stringify( require( './package.json' ).version ),
			__COMMIT__: JSON.stringify( process.env.GIT_COMMIT )
		} )
	]
};
