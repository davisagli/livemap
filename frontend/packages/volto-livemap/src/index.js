import LiveMapBlockView from './components/Blocks/LiveMap/View';
import mapSVG from '@plone/volto/icons/map.svg';

const applyConfig = (config) => {
  config.settings = {
    ...config.settings,
    isMultilingual: false,
    supportedLanguages: ['en'],
    defaultLanguage: 'en',
  };

  config.blocks.blocksConfig.livemap = {
    id: 'livemap',
    title: 'Live Map',
    icon: mapSVG,
    group: 'common',
    view: LiveMapBlockView,
    edit: LiveMapBlockView,
  };

  return config;
};

export default applyConfig;
