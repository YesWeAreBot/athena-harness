<script lang="ts">
import { parse } from "@cordisjs/element";
import { defineComponent, h } from "vue";

import { renderElements } from "./render";

export default defineComponent({
  name: "MessageContent",
  props: {
    content: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () => h("div", { class: "message-content" }, renderElements(parse(props.content)));
  },
});
</script>

<style lang="scss" scoped>
.message-content {
  white-space: break-spaces;
  position: relative;

  :deep(img),
  :deep(audio),
  :deep(video) {
    display: block;
    max-height: 320px;
    max-width: 100%;
  }

  :deep(p) {
    margin: 0;
  }
}
</style>
