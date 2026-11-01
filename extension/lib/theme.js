// ImmoAdv-Fade-Farben für den ganzen Browser (offizielle Design-Schnittstelle von Firefox).
'use strict';
const Theme = (() => {
  const FADE = {
    colors: {
      frame: '#0f2240', frame_inactive: '#0f2240',
      tab_background_text: '#a7b4c8', tab_text: '#eef3fb', tab_selected: 'rgba(255,255,255,0.11)',
      tab_line: '#19C2B0', tab_loading: '#19C2B0', tab_background_separator: 'rgba(0,0,0,0)',
      toolbar: 'rgba(0,0,0,0)', toolbar_text: '#eef3fb', toolbar_top_separator: 'rgba(0,0,0,0)', toolbar_bottom_separator: 'rgba(255,255,255,0.08)',
      toolbar_vertical_separator: 'rgba(255,255,255,0.08)',
      toolbar_field: 'rgba(255,255,255,0.07)', toolbar_field_text: '#eef3fb', toolbar_field_border: 'rgba(255,255,255,0.14)',
      toolbar_field_focus: '#183863', toolbar_field_text_focus: '#eef3fb', toolbar_field_border_focus: '#4b7bff',
      toolbar_field_highlight: 'rgba(75,123,255,0.45)', toolbar_field_highlight_text: '#ffffff',
      button_background_hover: 'rgba(255,255,255,0.11)', button_background_active: 'rgba(255,255,255,0.16)',
      icons: '#a7b4c8', icons_attention: '#19C2B0', bookmark_text: '#a7b4c8',
      popup: '#183863', popup_text: '#eef3fb', popup_border: 'rgba(255,255,255,0.14)', popup_highlight: 'rgba(255,255,255,0.08)', popup_highlight_text: '#ffffff',
      sidebar: '#14305a', sidebar_text: '#eef3fb', sidebar_border: 'rgba(255,255,255,0.08)', sidebar_highlight: 'rgba(75,123,255,0.35)', sidebar_highlight_text: '#ffffff',
      ntp_background: '#0f2240', ntp_text: '#eef3fb'
    },
    properties: { color_scheme: 'dark', content_color_scheme: 'dark' }
  };
  async function apply() { try { await browser.theme.update(FADE); } catch (e) { console.warn('Design', e); } }
  return { apply };
})();
