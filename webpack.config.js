const path = require("path");
const APP_SOURCE = path.join(__dirname, "src");

module.exports = {
	entry: path.join(APP_SOURCE, "index.ts"),
	externals: {
		jquery: "jQuery",
		math: "Math",
//		mw: "MediaWiki",
		mw: "mw",
		oojs: "OO",
		ooui: ["OO", "ui"],
		window: "window",
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
		],
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js'],
	},
	output: {
		filename: "main.js",
		path: path.resolve(__dirname, "dist"),
	},
	devServer: {
		contentBase: APP_SOURCE,
		port: 8080,
		sockPort: 8080,
		liveReload: false,

		// Fixes "GET https://localhost:8080/sockjs-node/info?t=... net::ERR_SSL_PROTOCOL_ERROR".
		public: '127.0.0.1',

		// Fixes "Invalid Host/Origin header".
		disableHostCheck: true,

		// To use in a DevTools snippet.
		writeToDisk: true,
	},
};
