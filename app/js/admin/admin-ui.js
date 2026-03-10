import { createToastController } from "../utils/toast.js";
import { createMessageSetters } from "../utils/messages.js";

const { showToast } = createToastController();
const { msgJobs, msgRegs, msgCreate } = createMessageSetters({
  msgJobs: "msgJobs",
  msgRegs: "msgRegs",
  msgCreate: "msgCreate"
});

export { showToast, msgJobs, msgRegs, msgCreate };
