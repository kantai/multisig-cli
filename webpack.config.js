
'use strict';
const path = require('path');

const APPDIR = 'dist/';

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HTMLWebpackPluginConfig = new HtmlWebpackPlugin({
    template: './src/index.html',
    filename: 'index.html',
    inject: 'body'
});

const BufferProvider = new webpack.ProvidePlugin({
    Buffer: [require.resolve("buffer/"), "Buffer"],
});

module.exports = {
    entry: './src/weblib.ts',
    mode: 'development',
    module: {
        rules: [
          {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/
          },
          {
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
          }
        ]
      },
      resolve: {
        extensions: [ '.tsx', '.ts', '.js' ],
        fallback: { "stream": require.resolve("stream-browserify") }
      },
    output: {
        library: "MultiStx",
        path: path.resolve(__dirname, APPDIR),
        filename: 'bundle.js',
    },
    plugins: [
        HTMLWebpackPluginConfig,
        BufferProvider,
    ]
};