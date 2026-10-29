import { defineComponent, h } from "vue";
// H5 wallet controls need native keyboard, disabled and accessibility semantics.
export default defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h("button", { type: "button", ...attrs }, slots.default?.());
  },
});
