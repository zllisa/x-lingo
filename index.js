import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './app/App';

// iOS AppDelegate uses moduleName "xlingo"; Android MainActivity uses "main".
// Register both so the same root component works on either platform.
AppRegistry.registerComponent('xlingo', () => App);
AppRegistry.registerComponent('main', () => App);
