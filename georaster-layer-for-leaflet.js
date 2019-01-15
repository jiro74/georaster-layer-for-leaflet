let chroma = require("chroma-js");

let L = window.L;

var GeoRasterLayer = L.GridLayer.extend({

    initialize: function(options) {
        try {
            console.log("starting GeoRasterLayer.initialize with", options);

            if (!options.keepBuffer) options.keepBuffer = 25;

            if (!options.resolution) options.resolution = Math.pow(2, 5);

            if (options.updateWhenZooming === undefined) options.updateWhenZooming = false;

            let georaster = options.georaster;
            this.georaster = georaster;

            this.scale = chroma.scale(['black', 'white']);
            // this.scale = chroma.scale();

            /*
                Unpacking values for use later.
                We do this in order to increase speed.
            */
            this._maxs = georaster.maxs;
            this._mins = georaster.mins;
            this._ranges = georaster.ranges;
            this._no_data_value = georaster.noDataValue;
            this._pixelWidth = georaster.pixelWidth;
            this._pixelHeight = georaster.pixelHeight;
            this._rasters = georaster.values;
            this._tiff_width = georaster.width;
            this._xmin = georaster.xmin;
            this._ymin = georaster.ymin;
            this._xmax = georaster.xmax;
            this._ymax = georaster.ymax;

            console.log("georaster.ymin:", georaster.ymin);
            let southWest = L.latLng(georaster.ymin, georaster.xmin);
            let northEast = L.latLng(georaster.ymax, georaster.xmax);
            this._bounds = L.latLngBounds(southWest, northEast);
            console.log("this._bounds:", this._bounds);
            options.bounds = this._bounds;
            L.setOptions(this, options);

            /*
                Caching the constant tile size, so we don't recalculate everytime we
                create a new tile
            */
            let tileSize = this.getTileSize();
            this._tile_height = tileSize.y;
            this._tile_width = tileSize.x;

        } catch (error) {
            console.error("ERROR initializing GeoTIFFLayer", error);
        }
    },

    createTile: function(coords, done) {
    // createTile: function(coords) {

        var error;

        console.log('createTile: ', coords);
        let debug_level = 2;

        if (debug_level >= 1) {
            var start_time = performance.now();
            var duration_reading_rasters = 0;
            var time_started_reading_rasters;
            var time_started_filling_rect;
            var duration_filling_rects = 0;
        }


        /*
            Unpacking values for use later.
            We do this in order to increase speed.
        */
        let maxs = this._maxs;
        let mins = this._mins;
        let ranges = this._ranges;
        let no_data_value = this._no_data_value;
        let pixelWidth = this._pixelWidth;
        let pixelHeight = this._pixelHeight;
        let rasters = this._rasters;
        let scale = this.scale;
        let tiff_width = this._tiff_width;
        let xmin = this._xmin;
        let ymin = this._ymin;
        let xmax = this._xmax;
        let ymax = this._ymax;

        //if (debug_level >= 1) console.group();

        //if (debug_level >= 1) console.log("starting createTile with coords:", coords);


        // create a <canvas> element for drawing
        let tile = L.DomUtil.create('canvas', 'leaflet-tile');
        tile.height = this._tile_height;
        tile.width = this._tile_width;


        // get a canvas context and draw something on it using coords.x, coords.y and coords.z
        let context = tile.getContext('2d');

        let bounds = this._tileCoordsToBounds(coords);
        //if (debug_level >= 1) console.log("bounds:", bounds);

        let xmin_of_tile = bounds.getWest();
        let xmax_of_tile = bounds.getEast();
        let ymin_of_tile = bounds.getSouth();
        let ymax_of_tile = bounds.getNorth();
        //if (debug_level >= 1) console.log("ymax_of_tile:", ymax_of_tile);

        let resolution = this.options.resolution;

        let raster_pixels_across = Math.ceil((xmax_of_tile - xmin_of_tile) / pixelWidth);
        let raster_pixels_down = Math.ceil((ymax_of_tile - ymin_of_tile) / pixelHeight);
        let number_of_rectangles_across = Math.min(resolution, raster_pixels_across);
        let number_of_rectangles_down = Math.min(resolution, raster_pixels_down);

        let height_of_rectangle_in_pixels = this._tile_height / number_of_rectangles_down;
        let height_of_rectangle_in_pixels_int = Math.ceil(height_of_rectangle_in_pixels);
        //if (debug_level >= 1) console.log("height_of_rectangle_in_pixels:", height_of_rectangle_in_pixels);
        let width_of_rectangle_in_pixels = this._tile_width / number_of_rectangles_across;
        let width_of_rectangle_in_pixels_int = Math.ceil(width_of_rectangle_in_pixels);
        //if (debug_level >= 1) console.log("width_of_rectangle:", width_of_rectangle_in_pixels);

        let height_of_rectangle_in_degrees = ( ymax_of_tile - ymin_of_tile ) / number_of_rectangles_down;
        //if (debug_level >= 1) console.log("height_of_rectangle_in_degrees:", height_of_rectangle_in_degrees);
        let width_of_rectangle_in_degrees = ( xmax_of_tile - xmin_of_tile ) / number_of_rectangles_across;
        //if (debug_level >= 1) console.log("width_of_rectangle_in_degrees:", width_of_rectangle_in_degrees);

        //if (debug_level >= 1) console.log("ymax of raster:", ymax);

        let number_of_pixels_per_rectangle = this._tile_width / 8;

        let map = this._map;
        let tileSize = this.getTileSize();
        let tileNwPoint = coords.scaleBy(tileSize);

        // render asynchronously so tiles show up as they finish instead of all at once (which blocks the UI)
        (async function () {
            let min_x = Number.MAX_SAFE_INTEGER;
            let max_x = 0;
            let min_y = Number.MAX_SAFE_INTEGER;
            let max_y = 0;

            let samples_per_pixel = null;
            let tile_values = [];
            if (rasters) {
              samples_per_pixel = rasters.length;
              for (let samp_i = 0; samp_i < samples_per_pixel; samp_i++) {
                tile_values.push([]);
              }
            }

            for (let h = 0; h < number_of_rectangles_down; h++) {
                let y_center_in_map_pixels = tileNwPoint.y + (h + 0.5) * height_of_rectangle_in_pixels;
                let latWestPoint = L.point(tileNwPoint.x, y_center_in_map_pixels);
                let latWest = map.unproject(latWestPoint, coords.z);
                let lat = latWest.lat;
                //if (debug_level >= 2) console.log("lat:", lat);
                if ((!rasters) || (lat > ymin && lat < ymax)) {
                  let y_in_tile_pixels = Math.round(h * height_of_rectangle_in_pixels);
                  let y_in_raster_pixels = Math.floor( (ymax - lat) / pixelHeight );
                  for (let w = 0; w < number_of_rectangles_across; w++) {
                    let latLngPoint = L.point(tileNwPoint.x + (w + 0.5) * width_of_rectangle_in_pixels, y_center_in_map_pixels);
                    let latLng = map.unproject(latLngPoint, coords.z);
                    let lng = latLng.lng;
                    //if (debug_level >= 2) console.log("lng:", lng);
                    if ((!rasters) || (lng > xmin && lng < xmax)) {
                        //if (debug_level >= 2) L.circleMarker([lat, lng], {color: "#00FF00"}).bindTooltip(h+","+w).addTo(this._map).openTooltip();
                        let x_in_raster_pixels = Math.floor( (lng - xmin) / pixelWidth );

                        if (debug_level >= 1) time_started_reading_rasters = performance.now();
                        if (rasters) {
                          let values = rasters.map(raster => raster[y_in_raster_pixels][x_in_raster_pixels]);
                          for (let val_i = 0; val_i < samples_per_pixel; val_i++) {
                            tile_values[val_i].push(values[val_i])
                          }
                        } else {
                          if (y_in_raster_pixels < min_y) {
                            min_y = y_in_raster_pixels;
                          }
                          if (y_in_raster_pixels > max_y) {
                            max_y = y_in_raster_pixels;
                          }
                          if (x_in_raster_pixels < min_x) {
                            min_x = x_in_raster_pixels;
                          }
                          if (x_in_raster_pixels > max_x) {
                            max_x = x_in_raster_pixels;
                          }
                        }
                    } else {
                        if (rasters) {
                          for (let val_i = 0; val_i < samples_per_pixel; val_i++) {
                            tile_values[val_i].push(0);
                          }
                        }
                    }
                  }
                } else {
                    if (rasters) {
                      for (let w = 0; w < number_of_rectangles_across; w++) {
                        for (let val_i = 0; val_i < samples_per_pixel; val_i++) {
                          tile_values[val_i].push(0);
                        }
                      }
                    }
                }
            }

            if (!rasters) {
              // careful not to flip min_y/max_y here
              tile_values = await this.georaster.getValues(min_x, min_y, max_x, max_y, number_of_rectangles_across, number_of_rectangles_down);
            }

            let tile_values_2d = tile_values.map(valuesInOneDimension => {
              const valuesInTwoDimensions = [];
              const width = number_of_rectangles_across;
              const height = number_of_rectangles_down;
              for (let y = 0; y < height; y++) {
                const start = y * width;
                const end = start + width;
                valuesInTwoDimensions.push(valuesInOneDimension.slice(start, end));
              }
              return valuesInTwoDimensions;
            });

            for (let h = 0; h < number_of_rectangles_down; h++) {
                let y_center_in_map_pixels = tileNwPoint.y + (h + 0.5) * height_of_rectangle_in_pixels;
                let latWestPoint = L.point(tileNwPoint.x, y_center_in_map_pixels);
                let latWest = map.unproject(latWestPoint, coords.z);
                let lat = latWest.lat;
                //if (debug_level >= 2) console.log("lat:", lat);
                if (lat > ymin && lat < ymax) {
                  let y_in_tile_pixels = Math.round(h * height_of_rectangle_in_pixels);
                  let y_in_raster_pixels = Math.floor( (ymax - lat) / pixelHeight );
                  for (let w = 0; w < number_of_rectangles_across; w++) {
                    let latLngPoint = L.point(tileNwPoint.x + (w + 0.5) * width_of_rectangle_in_pixels, y_center_in_map_pixels);
                    let latLng = map.unproject(latLngPoint, coords.z);
                    let lng = latLng.lng;
                    //if (debug_level >= 2) console.log("lng:", lng);
                    if (lng > xmin && lng < xmax) {
                        //if (debug_level >= 2) L.circleMarker([lat, lng], {color: "#00FF00"}).bindTooltip(h+","+w).addTo(this._map).openTooltip();
                        let x_in_raster_pixels = Math.floor( (lng - xmin) / pixelWidth );

                        if (debug_level >= 1) time_started_reading_rasters = performance.now();
                        let values = tile_values_2d.map(raster => raster[h][w]);
                        if (debug_level >= 1) duration_reading_rasters += performance.now() - time_started_reading_rasters;
                        let color = null;
                        if(this.options.pixelValueToColorFn) {
                          color = this.options.pixelValueToColorFn(values[0]);
                        } else {
                          let number_of_values = values.length;
                          if (number_of_values == 1) {
                              let value = values[0];
                              if (value != no_data_value) {
                                  // color = scale( (values[0] - mins[0]) / ranges[0] ).hex();
                                  color = scale( (values[0] - 10798) / (16110-10798)).hex();
                              }
                          } else if (number_of_values == 2) {
                          } else if (number_of_values == 3) {
                              if (values[0] != no_data_value) {
                                  color = "rgb(" + values[0] + "," + values[1] + "," + values[2] + ")";
                              }
                          }
                        }
                        //let colors = ["red", "green", "blue", "pink", "purple", "orange"];
                        //let color = colors[Math.round(colors.length * Math.random())];
                        //context.fillStyle = this.getColor(color);
                        if (color) {
                            context.fillStyle = color;
                            if (debug_level >= 1) time_started_filling_rect = performance.now();
                            context.fillRect(Math.round(w * width_of_rectangle_in_pixels), y_in_tile_pixels, width_of_rectangle_in_pixels_int, height_of_rectangle_in_pixels_int);
                            if (debug_level >= 1) duration_filling_rects += performance.now() - time_started_filling_rect;
                        }
                        //if (debug_level >= 2) console.log("filling:", [w * width_of_rectangle_in_pixels, rect_y_in_pixels, width_of_rectangle_in_pixels_int, height_of_rectangle_in_pixels_int]);
                        //if (debug_level >= 2) console.log("with color:", color);
                        //if (debug_level >= 2) console.log("with context:", context);
                    } else {
                        //if (debug_level >= 2) L.circleMarker([lat, lng], {color: "#FF0000"}).bindTooltip(h+","+w).addTo(this._map).openTooltip();
                    }
                  }
                }
            }


            if (debug_level >= 1) {
                let duration = performance.now() - start_time;
                console.log("creating tile took ", duration, "milliseconds");
                console.log("took", duration_reading_rasters, "milliseconds to read rasters, which is ", Math.round(duration_reading_rasters / duration * 100), "percentage of the total time");
                console.log("took", duration_filling_rects, "milliseconds to fill rects, which is ", Math.round(duration_filling_rects / duration * 100), "percentage of the total time");
            }
            //if (debug_level >= 1) console.groupEnd();

            done(error, tile);
        }.bind(this))();

        // return the tile so it can be rendered on screen
        return tile;
    },

    // method from https://github.com/Leaflet/Leaflet/blob/bb1d94ac7f2716852213dd11563d89855f8d6bb1/src/layer/ImageOverlay.js
    getBounds: function () {
        return this._bounds;
    },

    getColor(name) {
        let d = document.createElement("div");
        d.style.color = name;
        document.body.appendChild(d)
        return window.getComputedStyle(d).color
    }

});

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = GeoRasterLayer;
}
if (typeof window !== "undefined") {
  window["GeoRasterLayer"] = GeoRasterLayer;
} else if (typeof self !== "undefined") {
  self["GeoRasterLayer"] = GeoRasterLayer; // jshint ignore:line
}
