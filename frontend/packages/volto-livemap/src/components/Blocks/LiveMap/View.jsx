import { useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

const View = (props) => {
  const { block } = props;

  const mapContainer = useRef(null);
  const mapref = useRef(null);
  const self = useRef({});
  const visitors = useRef({});
  const ws = useRef(null);

  const updateMap = () => {
    const points = Object.values(visitors.current);
    const features = {
      type: 'FeatureCollection',
      features: points.map((visitor) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: visitor.coordinates,
        },
        properties: visitor.properties,
      })),
    };
    if (points.length === 0) {
      return;
    }

    const map = mapref.current;
    const source = map.getSource('visitors');
    if (source) {
      source.setData(features);
    } else {
      // todo: adjust to keep points in frame?
      if (points.length) {
        map.setCenter(points[0].coordinates);
      }
      map.addSource('visitors', {
        type: 'geojson',
        data: features,
      });
      // implementation of StyleImageInterface to draw a pulsing dot icon on the map
      // Search for StyleImageInterface in https://maplibre.org/maplibre-gl-js/docs/API/
      const size = 100;
      const pulsingDot = {
        width: size,
        height: size,
        data: new Uint8Array(size * size * 4),

        // get rendering context for the map canvas when layer is added to the map
        onAdd() {
          const canvas = document.createElement('canvas');
          canvas.width = this.width;
          canvas.height = this.height;
          this.context = canvas.getContext('2d');
        },

        // called once before every frame where the icon will be used
        render() {
          //const duration = 2000;
          const t = 0; // (performance.now() % duration) / duration;

          const radius = (size / 2) * 0.3;
          const outerRadius = (size / 2) * 0.7 * t + radius;
          const context = this.context;

          // draw outer circle
          context.clearRect(0, 0, this.width, this.height);
          context.beginPath();
          context.arc(
            this.width / 2,
            this.height / 2,
            outerRadius,
            0,
            Math.PI * 2,
          );
          context.fillStyle = `rgba(255, 200, 200,${1 - t})`;
          context.fill();

          // draw inner circle
          context.beginPath();
          context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
          context.fillStyle = 'rgba(255, 100, 100, 1)';
          context.strokeStyle = 'white';
          context.lineWidth = 2 + 4 * (1 - t);
          context.fill();
          context.stroke();

          // update this image's data with data from the canvas
          this.data = context.getImageData(0, 0, this.width, this.height).data;

          // continuously repaint the map, resulting in the smooth animation of the dot
          // map.triggerRepaint();

          // return `true` to let the map know that the image was updated
          return true;
        },
      };
      map.addImage('pulsing-dot', pulsingDot, { pixelRatio: 2 });
      map.addLayer({
        id: 'visitors',
        type: 'symbol',
        source: 'visitors',
        layout: {
          'icon-image': 'pulsing-dot',
          'icon-allow-overlap': true,
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0.6, 0],
          'text-allow-overlap': true,
          'text-anchor': 'left',
        },
        paint: {
          'text-color': '#c00000',
        },
      });
    }
  };

  useEffect(() => {
    // persist uid
    let uid = localStorage.getItem('livemap_uid');
    if (uid === null) {
      uid = uuid();
      localStorage.setItem('livemap_uid', uid);
    }

    // connect to websocket
    ws.current = new WebSocket(
      `ws://localhost:8080/livemap/stream?block_id=${block}&user_id=${uid}`,
    );
    ws.current.onmessage = (m) => {
      const visitor = JSON.parse(m.data);
      console.log(visitor);
      if (visitor.active && visitor.location) {
        visitors.current[visitor.uid] = {
          coordinates: visitor.location.split(','),
          properties: visitor,
        };
      } else {
        delete visitors.current[visitor.uid];
      }
      if (mapref.current.ready) {
        updateMap();
      }
    };
    const trackLocation = () => {
      // get and send current location
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          self.current.location = `${pos.coords.longitude},${pos.coords.latitude}`;
          // todo: only send if it moved significantly
          ws.current.send(JSON.stringify(self.current));
        },
        (error) => console.log(error),
        { maximumAge: 1000, enableHighAccuracy: true },
      );
    };
    ws.current.onopen = () => {
      trackLocation();
      setInterval(trackLocation, 5000);
    };
  }, []);

  useEffect(() => {
    const map = (mapref.current = new maplibregl.Map({
      container: mapContainer.current,
      projection: 'globe',
      zoom: 14,
      style: 'https://tiles.openfreemap.org/styles/liberty',
    }));
    map.on('load', async () => {
      mapref.current.ready = true;
      updateMap();
    });
  }, []);
  return (
    <div className="livemap block">
      <input
        onChange={(e) => {
          self.current.name = e.target.value;
          ws.current.send(JSON.stringify(self.current));
        }}
      />
      <div ref={mapContainer} className="livemap"></div>
    </div>
  );
};

export default View;
