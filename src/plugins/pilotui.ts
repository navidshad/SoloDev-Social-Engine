import type { App } from 'vue'

// Import components and Styles
import vueComponents from "pilotui";
import 'pilotui/style.css';

// Configuration options
const options = {
	// Optional: Disable specific integrations
	dontInstallPinia: false,
	dontInstallPopper: false,
	dontInstallPerfectScrollbar: false,
};

export function PilotUI(app: App) {
	app.use(vueComponents, options);
}