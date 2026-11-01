// ImmoAdv-Fade-Farben für den ganzen Browser (offizielle Design-Schnittstelle von Firefox).
'use strict';
const Theme = (() => {
  const FADE = {
    colors: {
      frame: '#07111f', frame_inactive: '#07111f',
      tab_background_text: '#a7b4c8', tab_text: '#eef3fb', tab_selected: 'rgba(255,255,255,0.075)',
      tab_line: '#19C2B0', tab_loading: '#19C2B0', tab_background_separator: 'rgba(0,0,0,0)',
      toolbar: 'rgba(0,0,0,0)', toolbar_text: '#eef3fb', toolbar_top_separator: 'rgba(0,0,0,0)', toolbar_bottom_separator: 'rgba(255,255,255,0.08)',
      toolbar_vertical_separator: 'rgba(255,255,255,0.08)',
      toolbar_field: 'rgba(255,255,255,0.045)', toolbar_field_text: '#eef3fb', toolbar_field_border: 'rgba(255,255,255,0.14)',
      toolbar_field_focus: '#0d1b30', toolbar_field_text_focus: '#eef3fb', toolbar_field_border_focus: '#4b7bff',
      toolbar_field_highlight: 'rgba(75,123,255,0.45)', toolbar_field_highlight_text: '#ffffff',
      button_background_hover: 'rgba(255,255,255,0.075)', button_background_active: 'rgba(255,255,255,0.11)',
      icons: '#a7b4c8', icons_attention: '#19C2B0', bookmark_text: '#a7b4c8',
      popup: '#0d1b30', popup_text: '#eef3fb', popup_border: 'rgba(255,255,255,0.14)', popup_highlight: 'rgba(255,255,255,0.08)', popup_highlight_text: '#ffffff',
      sidebar: '#0b1a2e', sidebar_text: '#eef3fb', sidebar_border: 'rgba(255,255,255,0.08)', sidebar_highlight: 'rgba(75,123,255,0.35)', sidebar_highlight_text: '#ffffff',
      ntp_background: '#07111f', ntp_text: '#eef3fb'
    },
    properties: { color_scheme: 'dark', content_color_scheme: 'dark' }
  };
  async function apply() { try { await browser.theme.update(FADE); } catch (e) { console.warn('Design', e); } }
  return { apply };
})();
