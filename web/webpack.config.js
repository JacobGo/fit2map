module.exports = {
    entry: './src/app.js',
    devtool: 'source-map',
    mode: 'production',
    output: {
        path: __dirname,
        filename: 'bundle.js'
    },
    module: {
        rules: [
            {
                test: /\.(gpx|tcx|fit\.gz|fit|igc|skiz|derive|jpe?g)$/i,
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            name: 'data/[name].[ext]'
                        }
                    }
                ]
            }
        ]
    },
    node: {
        fs: 'empty'
    }
};
